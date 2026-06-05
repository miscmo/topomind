import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import type { SyncEntityType, SyncEventType } from './sync.types';

interface ChangeEventRow {
  id: string | number;
}

@Injectable()
export class EventWriter {
  async append(
    client: PoolClient,
    input: {
      workspaceId: string;
      entityType: SyncEntityType;
      entityId: string;
      eventType: SyncEventType;
      entityVersion: number;
      payload: Record<string, unknown>;
      createdByUserId: string;
    },
  ): Promise<number> {
    const result = await client.query<ChangeEventRow>(
      `
        INSERT INTO change_events (
          workspace_id,
          entity_type,
          entity_id,
          event_type,
          entity_version,
          payload_json,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.workspaceId,
        input.entityType,
        input.entityId,
        input.eventType,
        input.entityVersion,
        input.payload,
        input.createdByUserId,
      ],
    );

    return toSafeInteger(result.rows[0]?.id, 'event id');
  }
}

function toSafeInteger(value: string | number | undefined, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}`);
  }

  return parsed;
}
