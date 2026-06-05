import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { AppException } from './common/app-exception';
import { DatabaseService } from './database.service';
import type { WorkspaceSummary } from './auth.types';

interface WorkspaceRow {
  id: string;
  name: string;
  role: string;
  updated_at: Date;
}

interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{
    rows: T[];
  }>;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const result = await this.databaseService.query<WorkspaceRow>(
      `
        SELECT w.id, w.name, wm.role, w.updated_at
        FROM workspaces w
        INNER JOIN workspace_members wm
          ON wm.workspace_id = w.id
        WHERE wm.user_id = $1
          AND w.deleted_at IS NULL
        ORDER BY w.updated_at DESC, w.created_at DESC
      `,
      [userId],
    );

    return result.rows.map(toWorkspaceSummary);
  }

  async getWorkspaceForUser(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
    return this.assertWorkspaceAccess(userId, workspaceId);
  }

  async assertWorkspaceAccess(
    userId: string,
    workspaceId: string,
    queryable: Queryable = this.databaseService,
  ): Promise<WorkspaceSummary> {
    const workspaceIdValue = normalizeWorkspaceId(workspaceId);
    const result = await queryable.query<WorkspaceRow>(
      `
        SELECT w.id, w.name, wm.role, w.updated_at
        FROM workspaces w
        INNER JOIN workspace_members wm
          ON wm.workspace_id = w.id
        WHERE w.id = $1
          AND wm.user_id = $2
          AND w.deleted_at IS NULL
      `,
      [workspaceIdValue, userId],
    );

    const workspace = result.rows[0];

    if (!workspace) {
      throw new AppException(
        404,
        'WORKSPACE_NOT_FOUND',
        'Workspace does not exist or is not accessible',
      );
    }

    return toWorkspaceSummary(workspace);
  }

  async assertWorkspaceAccessInTransaction(
    userId: string,
    workspaceId: string,
    client: PoolClient,
  ): Promise<WorkspaceSummary> {
    return this.assertWorkspaceAccess(userId, workspaceId, client);
  }
}

function normalizeWorkspaceId(value: string): string {
  const workspaceId = value.trim();

  if (!workspaceId) {
    throw new AppException(422, 'VALIDATION_ERROR', 'Workspace ID is required');
  }

  return workspaceId;
}

function toWorkspaceSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    updatedAt: row.updated_at.toISOString(),
  };
}
