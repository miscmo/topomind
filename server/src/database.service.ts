import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { runMigrations } from './database/migration-runner';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://topomind:topomind@localhost:5432/topomind',
  });

  async onModuleInit(): Promise<void> {
    await this.ensureConnection();
    const migrationSummary = await runMigrations(this.pool);
    this.logger.log(
      `PostgreSQL connection is ready (${migrationSummary.appliedCount}/${migrationSummary.totalCount} migrations applied this run)`,
    );
  }

  async runMigrations(): Promise<void> {
    await this.ensureConnection();
    const migrationSummary = await runMigrations(this.pool);
    this.logger.log(
      `Migration execution finished (${migrationSummary.appliedCount}/${migrationSummary.totalCount} migrations applied this run)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    return this.pool.query<T>(text, [...values]);
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureConnection(): Promise<void> {
    await this.pool.query('select 1');
  }
}
