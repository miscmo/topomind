import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from './database.service';
import { WorkspacesService } from './workspaces.service';
import type { WorkspaceBootstrapData } from './sync.types';

interface LatestEventRow {
  last_event_id: string | number;
}

interface WorkspaceConfigRow {
  config_json: unknown;
  version: string | number;
  updated_at: Date;
}

interface KnowledgeBaseRow {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  cover_attachment_id: string | null;
  description: string | null;
  settings_json: unknown;
  version: string | number;
  created_at: Date;
  updated_at: Date;
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  card_id: string;
  type: string;
  title: string;
  parent_document_id: string | null;
  sort_order: number;
  schema_version: number;
  meta_json: unknown;
  version: string | number;
  created_at: Date;
  updated_at: Date;
}

interface GraphLayoutRow {
  id: string;
  workspace_id: string;
  kb_id: string;
  room_card_id: string | null;
  layout_json: unknown;
  viewport_json: unknown;
  version: string | number;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class BootstrapService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async getWorkspaceBootstrap(userId: string, workspaceId: string): Promise<WorkspaceBootstrapData> {
    return this.databaseService.withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

      const workspace = await this.workspacesService.assertWorkspaceAccessInTransaction(
        userId,
        workspaceId,
        client,
      );
      const lastEventId = await this.getLatestEventId(client, workspaceId);
      const config = await this.getWorkspaceConfig(client, workspaceId);
      const knowledgeBases = await this.getKnowledgeBases(client, workspaceId);
      const recentDocuments = await this.getRecentDocuments(client, workspaceId);
      const rootLayouts = await this.getRootLayouts(client, workspaceId);

      return {
        workspace,
        cursor: {
          lastEventId,
        },
        config,
        knowledgeBases,
        recentDocuments,
        rootLayouts,
      };
    });
  }

  private async getLatestEventId(client: PoolClient, workspaceId: string): Promise<number> {
    const result = await client.query<LatestEventRow>(
      `
        SELECT COALESCE(MAX(id), 0) AS last_event_id
        FROM change_events
        WHERE workspace_id = $1
      `,
      [workspaceId],
    );

    return toSafeInteger(result.rows[0]?.last_event_id, 'lastEventId');
  }

  private async getWorkspaceConfig(
    client: PoolClient,
    workspaceId: string,
  ): Promise<WorkspaceBootstrapData['config']> {
    const result = await client.query<WorkspaceConfigRow>(
      `
        SELECT config_json, version, updated_at
        FROM workspace_configs
        WHERE workspace_id = $1
      `,
      [workspaceId],
    );

    const row = result.rows[0];

    if (!row) {
      return {
        version: 1,
        configJson: {},
        updatedAt: null,
      };
    }

    return {
      version: toSafeInteger(row.version, 'workspace config version'),
      configJson: asObject(row.config_json),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async getKnowledgeBases(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await client.query<KnowledgeBaseRow>(
      `
        SELECT
          id,
          workspace_id,
          name,
          sort_order,
          cover_attachment_id,
          description,
          settings_json,
          version,
          created_at,
          updated_at
        FROM knowledge_bases
        WHERE workspace_id = $1
          AND deleted_at IS NULL
        ORDER BY sort_order ASC, updated_at DESC, created_at DESC
        LIMIT 100
      `,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      sortOrder: row.sort_order,
      coverAttachmentId: row.cover_attachment_id,
      description: row.description,
      settingsJson: asObject(row.settings_json),
      version: toSafeInteger(row.version, 'knowledge base version'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: null,
    }));
  }

  private async getRecentDocuments(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await client.query<DocumentRow>(
      `
        SELECT
          id,
          workspace_id,
          card_id,
          type,
          title,
          parent_document_id,
          sort_order,
          schema_version,
          meta_json,
          version,
          created_at,
          updated_at
        FROM documents
        WHERE workspace_id = $1
          AND deleted_at IS NULL
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 100
      `,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      cardId: row.card_id,
      type: row.type,
      title: row.title,
      parentDocumentId: row.parent_document_id,
      sortOrder: row.sort_order,
      schemaVersion: row.schema_version,
      metaJson: asObject(row.meta_json),
      version: toSafeInteger(row.version, 'document version'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: null,
    }));
  }

  private async getRootLayouts(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await client.query<GraphLayoutRow>(
      `
        SELECT
          id,
          workspace_id,
          kb_id,
          room_card_id,
          layout_json,
          viewport_json,
          version,
          updated_by_user_id,
          created_at,
          updated_at
        FROM graph_layouts
        WHERE workspace_id = $1
          AND room_card_id IS NULL
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 100
      `,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      kbId: row.kb_id,
      roomCardId: row.room_card_id,
      layoutJson: asObject(row.layout_json),
      viewportJson: asObject(row.viewport_json),
      version: toSafeInteger(row.version, 'graph layout version'),
      updatedBy: row.updated_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
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
