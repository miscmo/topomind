import { Injectable } from '@nestjs/common';

import { AppException } from './common/app-exception';
import { DatabaseService } from './database.service';
import type { SyncPullData, SyncPullEvent, SyncEntityType, SyncEventType } from './sync.types';
import { WorkspacesService } from './workspaces.service';

interface ChangeEventRow {
  id: string | number;
  entity_type: SyncEntityType;
  entity_id: string;
  event_type: SyncEventType;
  entity_version: string | number;
  payload_json: unknown;
  created_at: Date;
}

interface LatestEventRow {
  last_event_id: string | number;
}

@Injectable()
export class SyncPullService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async pull(
    userId: string,
    workspaceId: string,
    query: { afterEventId?: string; limit?: string },
  ): Promise<SyncPullData> {
    await this.workspacesService.assertWorkspaceAccess(userId, workspaceId);

    const afterEventId = normalizeAfterEventId(query.afterEventId);
    const limit = normalizeLimit(query.limit);
    const result = await this.databaseService.query<ChangeEventRow>(
      `
        SELECT
          id,
          entity_type,
          entity_id,
          event_type,
          entity_version,
          payload_json,
          created_at
        FROM change_events
        WHERE workspace_id = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT $3
      `,
      [workspaceId, afterEventId, limit + 1],
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const events = rows.map(toPullEvent);

    if (events.length > 0) {
      return {
        workspaceId,
        fromEventId: afterEventId,
        toEventId: events[events.length - 1].id,
        hasMore,
        events,
      };
    }

    const latestEventId = await this.getLatestEventId(workspaceId);

    return {
      workspaceId,
      fromEventId: afterEventId,
      toEventId: latestEventId,
      hasMore: false,
      events: [],
    };
  }

  private async getLatestEventId(workspaceId: string): Promise<number> {
    const result = await this.databaseService.query<LatestEventRow>(
      `
        SELECT COALESCE(MAX(id), 0) AS last_event_id
        FROM change_events
        WHERE workspace_id = $1
      `,
      [workspaceId],
    );

    return toSafeInteger(result.rows[0]?.last_event_id, 'lastEventId');
  }
}

function toPullEvent(row: ChangeEventRow): SyncPullEvent {
  return {
    id: toSafeInteger(row.id, 'event id'),
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    entityVersion: toSafeInteger(row.entity_version, 'entity version'),
    payload: asObject(row.payload_json),
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeAfterEventId(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppException(422, 'VALIDATION_ERROR', 'afterEventId must be a non-negative integer');
  }

  return parsed;
}

function normalizeLimit(value: string | undefined): number {
  if (value === undefined) {
    return 200;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppException(422, 'VALIDATION_ERROR', 'limit must be a positive integer');
  }

  return Math.min(parsed, 1000);
}

function toSafeInteger(value: string | number | undefined, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}`);
  }

  return parsed;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
