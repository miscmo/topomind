import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

interface Queryable {
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>;
}

interface MigrationFile {
  id: string;
  fileName: string;
  checksum: string;
  sql: string;
}

interface AppliedMigrationRow {
  id: string;
  checksum: string;
}

export interface MigrationSummary {
  appliedCount: number;
  totalCount: number;
}

export async function runMigrations(pool: Pool): Promise<MigrationSummary> {
  await ensureMigrationsTable(pool);

  const migrations = await loadMigrationFiles();
  const appliedMigrations = await loadAppliedMigrations(pool);

  let appliedCount = 0;

  for (const migration of migrations) {
    const existingMigration = appliedMigrations.get(migration.id);

    if (existingMigration) {
      if (existingMigration.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for ${migration.id}. Existing migrations must remain immutable.`,
        );
      }

      continue;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        `
          INSERT INTO schema_migrations (id, file_name, checksum)
          VALUES ($1, $2, $3)
        `,
        [migration.id, migration.fileName, migration.checksum],
      );
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    appliedCount,
    totalCount: migrations.length,
  };
}

async function ensureMigrationsTable(queryable: Queryable): Promise<void> {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function loadAppliedMigrations(
  queryable: Queryable,
): Promise<Map<string, AppliedMigrationRow>> {
  const result = (await queryable.query(`
    SELECT id, checksum
    FROM schema_migrations
    ORDER BY id ASC
  `)) as { rows: AppliedMigrationRow[] };

  return new Map(result.rows.map((row) => [row.id, row]));
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDirectory = join(__dirname, '..', '..', 'migrations');
  const fileNames = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const migrations = await Promise.all(
    fileNames.map(async (fileName) => {
      const sql = await readFile(join(migrationsDirectory, fileName), 'utf8');

      return {
        id: fileName.replace(/\.sql$/, ''),
        fileName,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    }),
  );

  ensureUniqueMigrationIds(migrations);
  return migrations;
}

function ensureUniqueMigrationIds(migrations: MigrationFile[]): void {
  const ids = new Set<string>();

  for (const migration of migrations) {
    if (ids.has(migration.id)) {
      throw new Error(`Duplicate migration id detected: ${migration.id}`);
    }

    ids.add(migration.id);
  }
}
