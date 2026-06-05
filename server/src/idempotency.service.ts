import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { AppException } from './common/app-exception';
import { DatabaseService } from './database.service';

interface IdempotencyRow {
  request_hash: string;
  response_json: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getReplay<T>(input: {
    workspaceId: string | null;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<T | null> {
    const result = await this.databaseService.query<IdempotencyRow>(
      `
        SELECT request_hash, response_json
        FROM idempotency_records
        WHERE workspace_id IS NOT DISTINCT FROM $1
          AND scope = $2
          AND idempotency_key = $3
          AND expires_at > NOW()
        LIMIT 1
      `,
      [input.workspaceId, input.scope, input.idempotencyKey],
    );

    const record = result.rows[0];

    if (!record) {
      return null;
    }

    ensureRequestHashMatches(record.request_hash, input.requestHash, input.scope, input.idempotencyKey);
    return asObject(record.response_json) as T;
  }

  async recordSuccess(
    client: PoolClient,
    input: {
      workspaceId: string;
      scope: string;
      idempotencyKey: string;
      requestHash: string;
      responseJson: Record<string, unknown>;
      resourceType: string;
      resourceId: string;
    },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + getIdempotencyTtlHours() * 60 * 60 * 1000);

    await client.query(
      `
        DELETE FROM idempotency_records
        WHERE workspace_id = $1
          AND scope = $2
          AND idempotency_key = $3
          AND expires_at <= NOW()
      `,
      [input.workspaceId, input.scope, input.idempotencyKey],
    );

    await client.query(
      `
        INSERT INTO idempotency_records (
          id,
          workspace_id,
          scope,
          idempotency_key,
          request_hash,
          response_json,
          resource_type,
          resource_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        input.workspaceId,
        input.scope,
        input.idempotencyKey,
        input.requestHash,
        input.responseJson,
        input.resourceType,
        input.resourceId,
        expiresAt,
      ],
    );
  }
}

export function buildRequestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function ensureRequestHashMatches(
  actualHash: string,
  expectedHash: string,
  scope: string,
  idempotencyKey: string,
): void {
  if (actualHash === expectedHash) {
    return;
  }

  throw new AppException(
    409,
    'IDEMPOTENCY_REPLAY',
    'Idempotency key has already been used with a different payload',
    {
      scope,
      idempotencyKey,
    },
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, itemValue]) => `${JSON.stringify(key)}:${stableStringify(itemValue)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function getIdempotencyTtlHours(): number {
  const rawValue = Number(process.env.IDEMPOTENCY_TTL_HOURS ?? 24 * 7);

  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return 24 * 7;
  }

  return rawValue;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error('Stored idempotency response is invalid');
}
