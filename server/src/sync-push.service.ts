import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppException } from './common/app-exception';
import { DatabaseService } from './database.service';
import { EventWriter } from './event-writer';
import { buildRequestHash, IdempotencyService } from './idempotency.service';
import type {
  NormalizedSyncPushInput,
  SyncClientInfo,
  SyncEntityType,
  SyncOperation,
  SyncPushRequest,
  SyncPushSuccessData,
  SyncWriteResult,
} from './sync.types';
import { WorkspacesService } from './workspaces.service';

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
  deleted_at: Date | null;
}

interface CardRow {
  id: string;
  workspace_id: string;
  kb_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  status: string;
  meta_json: unknown;
  version: string | number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
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
  content_json: unknown;
  meta_json: unknown;
  version: string | number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
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

interface AttachmentRow {
  id: string;
}

interface EntityEventRow {
  id: string | number;
}

const SYNC_PUSH_SCOPE = 'sync_push';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SyncPushService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly workspacesService: WorkspacesService,
    private readonly eventWriter: EventWriter,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async push(
    workspaceId: string,
    userId: string,
    request: SyncPushRequest,
  ): Promise<SyncPushSuccessData> {
    const input = normalizeSyncPushInput(workspaceId, userId, request);
    const requestHash = buildRequestHash({
      workspaceId: input.workspaceId,
      userId: input.userId,
      entityType: input.entityType,
      operation: input.operation,
      entityId: input.entityId,
      baseVersion: input.baseVersion,
      payload: input.payload,
    });

    await this.workspacesService.assertWorkspaceAccess(userId, workspaceId);

    const replay = await this.idempotencyService.getReplay<SyncPushSuccessData>({
      workspaceId: input.workspaceId,
      scope: SYNC_PUSH_SCOPE,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });

    if (replay) {
      return replay;
    }

    try {
      return await this.databaseService.withTransaction(async (client) => {
        await this.workspacesService.assertWorkspaceAccessInTransaction(
          input.userId,
          input.workspaceId,
          client,
        );

        const writeResult = await this.executeWrite(client, input);
        const eventId = await this.eventWriter.append(client, {
          workspaceId: input.workspaceId,
          entityType: writeResult.entityType,
          entityId: writeResult.entityId,
          eventType: writeResult.eventType,
          entityVersion: writeResult.entityVersion,
          payload: writeResult.entitySnapshot,
          createdByUserId: input.userId,
        });
        const response: SyncPushSuccessData = {
          entityType: writeResult.entityType,
          operation: input.operation,
          entity: writeResult.entitySnapshot,
          event: {
            id: eventId,
            entityVersion: writeResult.entityVersion,
          },
        };

        await this.idempotencyService.recordSuccess(client, {
          workspaceId: input.workspaceId,
          scope: SYNC_PUSH_SCOPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          responseJson: response as unknown as Record<string, unknown>,
          resourceType: input.entityType,
          resourceId: input.entityId,
        });

        return response;
      });
    } catch (error) {
      if (isIdempotencyUniqueViolation(error)) {
        const replayAfterRace = await this.idempotencyService.getReplay<SyncPushSuccessData>({
          workspaceId: input.workspaceId,
          scope: SYNC_PUSH_SCOPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        });

        if (replayAfterRace) {
          return replayAfterRace;
        }
      }

      if (isUniqueViolation(error)) {
        throw mapUniqueViolation(error);
      }

      throw error;
    }
  }

  private async executeWrite(
    client: PoolClient,
    input: NormalizedSyncPushInput,
  ): Promise<SyncWriteResult> {
    switch (input.entityType) {
      case 'knowledge_base':
        return this.writeKnowledgeBase(client, input);
      case 'card':
        return this.writeCard(client, input);
      case 'document':
        return this.writeDocument(client, input);
      case 'graph_layout':
        return this.writeGraphLayout(client, input);
      default:
        throw new AppException(422, 'VALIDATION_ERROR', 'Unsupported sync entity type');
    }
  }

  private async writeKnowledgeBase(
    client: PoolClient,
    input: NormalizedSyncPushInput,
  ): Promise<SyncWriteResult> {
    const current = await this.findKnowledgeBase(client, input.workspaceId, input.entityId);

    switch (input.operation) {
      case 'create': {
        ensureCreateVersion(input.baseVersion);

        if (current) {
          throw await this.buildAlreadyExistsException(client, input, mapKnowledgeBaseRow(current));
        }

        const payload = normalizeKnowledgeBaseCreatePayload(input.payload);

        if (payload.coverAttachmentId) {
          await this.assertAttachmentExists(client, input.workspaceId, payload.coverAttachmentId);
        }

        const result = await client.query<KnowledgeBaseRow>(
          `
            INSERT INTO knowledge_bases (
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            payload.name,
            payload.sortOrder,
            payload.coverAttachmentId,
            payload.description,
            payload.settingsJson,
          ],
        );

        return toWriteResult('knowledge_base', 'created', mapKnowledgeBaseRow(result.rows[0]));
      }
      case 'update': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapKnowledgeBaseRow(existing), existing.version);
        ensureNotDeleted(existing.deleted_at, input.entityType, input.entityId);

        const payload = normalizeKnowledgeBaseUpdatePayload(input.payload);
        const coverAttachmentId = pickDefined(payload.coverAttachmentId, existing.cover_attachment_id);

        if (coverAttachmentId) {
          await this.assertAttachmentExists(client, input.workspaceId, coverAttachmentId);
        }

        const result = await client.query<KnowledgeBaseRow>(
          `
            UPDATE knowledge_bases
            SET
              name = $3,
              sort_order = $4,
              cover_attachment_id = $5,
              description = $6,
              settings_json = $7,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            pickDefined(payload.name, existing.name),
            pickDefined(payload.sortOrder, existing.sort_order),
            coverAttachmentId,
            pickDefined(payload.description, existing.description),
            pickDefined(payload.settingsJson, asObject(existing.settings_json)),
          ],
        );

        return toWriteResult('knowledge_base', 'updated', mapKnowledgeBaseRow(result.rows[0]));
      }
      case 'delete': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapKnowledgeBaseRow(existing), existing.version);
        ensureCanDelete(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<KnowledgeBaseRow>(
          `
            UPDATE knowledge_bases
            SET
              deleted_at = NOW(),
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('knowledge_base', 'deleted', mapKnowledgeBaseRow(result.rows[0]));
      }
      case 'restore': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapKnowledgeBaseRow(existing), existing.version);
        ensureCanRestore(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<KnowledgeBaseRow>(
          `
            UPDATE knowledge_bases
            SET
              deleted_at = NULL,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('knowledge_base', 'restored', mapKnowledgeBaseRow(result.rows[0]));
      }
      default:
        return assertNever(input.operation);
    }
  }

  private async writeCard(
    client: PoolClient,
    input: NormalizedSyncPushInput,
  ): Promise<SyncWriteResult> {
    const current = await this.findCard(client, input.workspaceId, input.entityId);

    switch (input.operation) {
      case 'create': {
        ensureCreateVersion(input.baseVersion);

        if (current) {
          throw await this.buildAlreadyExistsException(client, input, mapCardRow(current));
        }

        const payload = normalizeCardCreatePayload(input.payload);
        await this.assertKnowledgeBaseExists(client, input.workspaceId, payload.kbId);

        if (payload.parentId) {
          const parent = await this.assertCardExists(client, input.workspaceId, payload.parentId);

          if (parent.kb_id !== payload.kbId) {
            throw new AppException(
              422,
              'RELATION_INVALID',
              'Parent card must belong to the same knowledge base',
            );
          }
        }

        const result = await client.query<CardRow>(
          `
            INSERT INTO cards (
              id,
              workspace_id,
              kb_id,
              parent_id,
              name,
              sort_order,
              status,
              meta_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING
              id,
              workspace_id,
              kb_id,
              parent_id,
              name,
              sort_order,
              status,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            payload.kbId,
            payload.parentId,
            payload.name,
            payload.sortOrder,
            payload.status,
            payload.metaJson,
          ],
        );

        return toWriteResult('card', 'created', mapCardRow(result.rows[0]));
      }
      case 'update': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapCardRow(existing), existing.version);
        ensureNotDeleted(existing.deleted_at, input.entityType, input.entityId);

        const payload = normalizeCardUpdatePayload(input.payload);
        const kbId = pickDefined(payload.kbId, existing.kb_id);
        const parentId = pickDefined(payload.parentId, existing.parent_id);

        await this.assertKnowledgeBaseExists(client, input.workspaceId, kbId);

        if (parentId) {
          if (parentId === input.entityId) {
            throw new AppException(422, 'VALIDATION_ERROR', 'parentId cannot equal entityId');
          }

          const parent = await this.assertCardExists(client, input.workspaceId, parentId);

          if (parent.kb_id !== kbId) {
            throw new AppException(
              422,
              'RELATION_INVALID',
              'Parent card must belong to the same knowledge base',
            );
          }
        }

        const result = await client.query<CardRow>(
          `
            UPDATE cards
            SET
              kb_id = $3,
              parent_id = $4,
              name = $5,
              sort_order = $6,
              status = $7,
              meta_json = $8,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              kb_id,
              parent_id,
              name,
              sort_order,
              status,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            kbId,
            parentId,
            pickDefined(payload.name, existing.name),
            pickDefined(payload.sortOrder, existing.sort_order),
            pickDefined(payload.status, existing.status),
            pickDefined(payload.metaJson, asObject(existing.meta_json)),
          ],
        );

        return toWriteResult('card', 'updated', mapCardRow(result.rows[0]));
      }
      case 'delete': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapCardRow(existing), existing.version);
        ensureCanDelete(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<CardRow>(
          `
            UPDATE cards
            SET
              deleted_at = NOW(),
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              kb_id,
              parent_id,
              name,
              sort_order,
              status,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('card', 'deleted', mapCardRow(result.rows[0]));
      }
      case 'restore': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapCardRow(existing), existing.version);
        ensureCanRestore(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<CardRow>(
          `
            UPDATE cards
            SET
              deleted_at = NULL,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              kb_id,
              parent_id,
              name,
              sort_order,
              status,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('card', 'restored', mapCardRow(result.rows[0]));
      }
      default:
        return assertNever(input.operation);
    }
  }

  private async writeDocument(
    client: PoolClient,
    input: NormalizedSyncPushInput,
  ): Promise<SyncWriteResult> {
    const current = await this.findDocument(client, input.workspaceId, input.entityId);

    switch (input.operation) {
      case 'create': {
        ensureCreateVersion(input.baseVersion);

        if (current) {
          throw await this.buildAlreadyExistsException(client, input, mapDocumentRow(current));
        }

        const payload = normalizeDocumentCreatePayload(input.payload);
        await this.assertCardExists(client, input.workspaceId, payload.cardId);

        if (payload.parentDocumentId) {
          const parent = await this.assertDocumentExists(client, input.workspaceId, payload.parentDocumentId);

          if (parent.card_id !== payload.cardId) {
            throw new AppException(
              422,
              'RELATION_INVALID',
              'Parent document must belong to the same card',
            );
          }
        }

        const result = await client.query<DocumentRow>(
          `
            INSERT INTO documents (
              id,
              workspace_id,
              card_id,
              type,
              title,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING
              id,
              workspace_id,
              card_id,
              type,
              title,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            payload.cardId,
            payload.type,
            payload.title,
            payload.parentDocumentId,
            payload.sortOrder,
            payload.schemaVersion,
            payload.contentJson,
            payload.metaJson,
          ],
        );

        return toWriteResult('document', 'created', mapDocumentRow(result.rows[0]));
      }
      case 'update': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapDocumentRow(existing), existing.version);
        ensureNotDeleted(existing.deleted_at, input.entityType, input.entityId);

        const payload = normalizeDocumentUpdatePayload(input.payload);
        const cardId = pickDefined(payload.cardId, existing.card_id);
        const parentDocumentId = pickDefined(payload.parentDocumentId, existing.parent_document_id);

        await this.assertCardExists(client, input.workspaceId, cardId);

        if (parentDocumentId) {
          if (parentDocumentId === input.entityId) {
            throw new AppException(
              422,
              'VALIDATION_ERROR',
              'parentDocumentId cannot equal entityId',
            );
          }

          const parent = await this.assertDocumentExists(client, input.workspaceId, parentDocumentId);

          if (parent.card_id !== cardId) {
            throw new AppException(
              422,
              'RELATION_INVALID',
              'Parent document must belong to the same card',
            );
          }
        }

        const result = await client.query<DocumentRow>(
          `
            UPDATE documents
            SET
              card_id = $3,
              type = $4,
              title = $5,
              parent_document_id = $6,
              sort_order = $7,
              schema_version = $8,
              content_json = $9,
              meta_json = $10,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              card_id,
              type,
              title,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [
            input.entityId,
            input.workspaceId,
            cardId,
            pickDefined(payload.type, existing.type),
            pickDefined(payload.title, existing.title),
            parentDocumentId,
            pickDefined(payload.sortOrder, existing.sort_order),
            pickDefined(payload.schemaVersion, existing.schema_version),
            pickDefined(payload.contentJson, asObject(existing.content_json)),
            pickDefined(payload.metaJson, asObject(existing.meta_json)),
          ],
        );

        return toWriteResult('document', 'updated', mapDocumentRow(result.rows[0]));
      }
      case 'delete': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapDocumentRow(existing), existing.version);
        ensureCanDelete(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<DocumentRow>(
          `
            UPDATE documents
            SET
              deleted_at = NOW(),
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              card_id,
              type,
              title,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('document', 'deleted', mapDocumentRow(result.rows[0]));
      }
      case 'restore': {
        const existing = ensureEntityExists(current, input.entityType, input.entityId);
        await this.assertVersionMatches(client, input, mapDocumentRow(existing), existing.version);
        ensureCanRestore(existing.deleted_at, input.entityType, input.entityId);
        const result = await client.query<DocumentRow>(
          `
            UPDATE documents
            SET
              deleted_at = NULL,
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
            RETURNING
              id,
              workspace_id,
              card_id,
              type,
              title,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at
          `,
          [input.entityId, input.workspaceId],
        );

        return toWriteResult('document', 'restored', mapDocumentRow(result.rows[0]));
      }
      default:
        return assertNever(input.operation);
    }
  }

  private async writeGraphLayout(
    client: PoolClient,
    input: NormalizedSyncPushInput,
  ): Promise<SyncWriteResult> {
    if (input.operation === 'delete' || input.operation === 'restore') {
      throw new AppException(
        422,
        'UNSUPPORTED_SYNC_OPERATION',
        'graph_layout only supports create and update in the current schema',
      );
    }

    const current = await this.findGraphLayout(client, input.workspaceId, input.entityId);

    if (input.operation === 'create') {
      ensureCreateVersion(input.baseVersion);

      if (current) {
        throw await this.buildAlreadyExistsException(client, input, mapGraphLayoutRow(current));
      }

      const payload = normalizeGraphLayoutCreatePayload(input.payload);
      await this.assertKnowledgeBaseExists(client, input.workspaceId, payload.kbId);

      if (payload.roomCardId) {
        const roomCard = await this.assertCardExists(client, input.workspaceId, payload.roomCardId);

        if (roomCard.kb_id !== payload.kbId) {
          throw new AppException(
            422,
            'RELATION_INVALID',
            'roomCardId must belong to the same knowledge base',
          );
        }
      }

      await this.ensureLayoutScopeAvailable(
        client,
        input.workspaceId,
        payload.kbId,
        payload.roomCardId,
        input.entityId,
      );

      const result = await client.query<GraphLayoutRow>(
        `
          INSERT INTO graph_layouts (
            id,
            workspace_id,
            kb_id,
            room_card_id,
            layout_json,
            viewport_json,
            updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
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
        `,
        [
          input.entityId,
          input.workspaceId,
          payload.kbId,
          payload.roomCardId,
          payload.layoutJson,
          payload.viewportJson,
          input.userId,
        ],
      );

      return toWriteResult('graph_layout', 'created', mapGraphLayoutRow(result.rows[0]));
    }

    const existing = ensureEntityExists(current, input.entityType, input.entityId);
    await this.assertVersionMatches(client, input, mapGraphLayoutRow(existing), existing.version);
    const payload = normalizeGraphLayoutUpdatePayload(input.payload);
    const kbId = pickDefined(payload.kbId, existing.kb_id);
    const roomCardId = pickDefined(payload.roomCardId, existing.room_card_id);

    await this.assertKnowledgeBaseExists(client, input.workspaceId, kbId);

    if (roomCardId) {
      const roomCard = await this.assertCardExists(client, input.workspaceId, roomCardId);

      if (roomCard.kb_id !== kbId) {
        throw new AppException(
          422,
          'RELATION_INVALID',
          'roomCardId must belong to the same knowledge base',
        );
      }
    }

    await this.ensureLayoutScopeAvailable(client, input.workspaceId, kbId, roomCardId, input.entityId);

    const result = await client.query<GraphLayoutRow>(
      `
        UPDATE graph_layouts
        SET
          kb_id = $3,
          room_card_id = $4,
          layout_json = $5,
          viewport_json = $6,
          updated_by_user_id = $7,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $1
          AND workspace_id = $2
        RETURNING
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
      `,
      [
        input.entityId,
        input.workspaceId,
        kbId,
        roomCardId,
        pickDefined(payload.layoutJson, asObject(existing.layout_json)),
        pickDefined(payload.viewportJson, asObject(existing.viewport_json)),
        input.userId,
      ],
    );

    return toWriteResult('graph_layout', 'updated', mapGraphLayoutRow(result.rows[0]));
  }

  private async findKnowledgeBase(
    client: PoolClient,
    workspaceId: string,
    entityId: string,
  ): Promise<KnowledgeBaseRow | null> {
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
          updated_at,
          deleted_at
        FROM knowledge_bases
        WHERE workspace_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [workspaceId, entityId],
    );

    return result.rows[0] ?? null;
  }

  private async findCard(client: PoolClient, workspaceId: string, entityId: string): Promise<CardRow | null> {
    const result = await client.query<CardRow>(
      `
        SELECT
          id,
          workspace_id,
          kb_id,
          parent_id,
          name,
          sort_order,
          status,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at
        FROM cards
        WHERE workspace_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [workspaceId, entityId],
    );

    return result.rows[0] ?? null;
  }

  private async findDocument(
    client: PoolClient,
    workspaceId: string,
    entityId: string,
  ): Promise<DocumentRow | null> {
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
          content_json,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at
        FROM documents
        WHERE workspace_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [workspaceId, entityId],
    );

    return result.rows[0] ?? null;
  }

  private async findGraphLayout(
    client: PoolClient,
    workspaceId: string,
    entityId: string,
  ): Promise<GraphLayoutRow | null> {
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
          AND id = $2
        FOR UPDATE
      `,
      [workspaceId, entityId],
    );

    return result.rows[0] ?? null;
  }

  private async assertVersionMatches(
    client: PoolClient,
    input: NormalizedSyncPushInput,
    serverEntity: Record<string, unknown>,
    serverVersionRaw: string | number,
  ): Promise<void> {
    const serverVersion = toSafeInteger(serverVersionRaw, 'server entity version');

    if (input.baseVersion === serverVersion) {
      return;
    }

    const serverEventId = await this.findLatestEntityEventId(
      client,
      input.workspaceId,
      input.entityType,
      input.entityId,
    );

    throw new AppException(409, 'VERSION_CONFLICT', 'Entity version is outdated', {
      entityType: input.entityType,
      entityId: input.entityId,
      clientBaseVersion: input.baseVersion,
      serverVersion,
      serverEntity,
      serverEventId,
    });
  }

  private async buildAlreadyExistsException(
    client: PoolClient,
    input: NormalizedSyncPushInput,
    serverEntity: Record<string, unknown>,
  ): Promise<AppException> {
    const serverEventId = await this.findLatestEntityEventId(
      client,
      input.workspaceId,
      input.entityType,
      input.entityId,
    );

    return new AppException(409, 'ENTITY_ALREADY_EXISTS', 'Entity already exists', {
      entityType: input.entityType,
      entityId: input.entityId,
      serverVersion: serverEntity.version,
      serverEntity,
      serverEventId,
    });
  }

  private async findLatestEntityEventId(
    client: PoolClient,
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<number | null> {
    const result = await client.query<EntityEventRow>(
      `
        SELECT id
        FROM change_events
        WHERE workspace_id = $1
          AND entity_type = $2
          AND entity_id = $3
        ORDER BY id DESC
        LIMIT 1
      `,
      [workspaceId, entityType, entityId],
    );

    const row = result.rows[0];
    return row ? toSafeInteger(row.id, 'entity event id') : null;
  }

  private async assertKnowledgeBaseExists(
    client: PoolClient,
    workspaceId: string,
    kbId: string,
  ): Promise<KnowledgeBaseRow> {
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
          updated_at,
          deleted_at
        FROM knowledge_bases
        WHERE workspace_id = $1
          AND id = $2
        LIMIT 1
      `,
      [workspaceId, kbId],
    );

    const row = result.rows[0];

    if (!row || row.deleted_at) {
      throw new AppException(422, 'RELATION_INVALID', 'knowledge_base does not exist');
    }

    return row;
  }

  private async assertCardExists(
    client: PoolClient,
    workspaceId: string,
    cardId: string,
  ): Promise<CardRow> {
    const result = await client.query<CardRow>(
      `
        SELECT
          id,
          workspace_id,
          kb_id,
          parent_id,
          name,
          sort_order,
          status,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at
        FROM cards
        WHERE workspace_id = $1
          AND id = $2
        LIMIT 1
      `,
      [workspaceId, cardId],
    );

    const row = result.rows[0];

    if (!row || row.deleted_at) {
      throw new AppException(422, 'RELATION_INVALID', 'card does not exist');
    }

    return row;
  }

  private async assertDocumentExists(
    client: PoolClient,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentRow> {
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
          content_json,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at
        FROM documents
        WHERE workspace_id = $1
          AND id = $2
        LIMIT 1
      `,
      [workspaceId, documentId],
    );

    const row = result.rows[0];

    if (!row || row.deleted_at) {
      throw new AppException(422, 'RELATION_INVALID', 'document does not exist');
    }

    return row;
  }

  private async assertAttachmentExists(
    client: PoolClient,
    workspaceId: string,
    attachmentId: string,
  ): Promise<void> {
    const result = await client.query<AttachmentRow>(
      `
        SELECT id
        FROM attachments
        WHERE workspace_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [workspaceId, attachmentId],
    );

    if (!result.rows[0]) {
      throw new AppException(422, 'RELATION_INVALID', 'attachment does not exist');
    }
  }

  private async ensureLayoutScopeAvailable(
    client: PoolClient,
    workspaceId: string,
    kbId: string,
    roomCardId: string | null,
    entityId: string,
  ): Promise<void> {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM graph_layouts
        WHERE workspace_id = $1
          AND kb_id = $2
          AND room_card_id IS NOT DISTINCT FROM $3
          AND id <> $4
        LIMIT 1
      `,
      [workspaceId, kbId, roomCardId, entityId],
    );

    if (result.rows[0]) {
      throw new AppException(
        409,
        'LAYOUT_ALREADY_EXISTS',
        'Graph layout already exists for the requested room scope',
      );
    }
  }
}

function normalizeSyncPushInput(
  workspaceId: string,
  userId: string,
  request: SyncPushRequest,
): NormalizedSyncPushInput {
  const normalizedWorkspaceId = normalizeUuid(workspaceId, 'Workspace ID');

  return {
    workspaceId: normalizedWorkspaceId,
    userId: normalizeUuid(userId, 'User ID'),
    entityType: normalizeEntityType(request.entityType),
    operation: normalizeOperation(request.operation),
    entityId: normalizeUuid(request.entityId, 'Entity ID'),
    baseVersion: normalizeBaseVersion(request.baseVersion, request.operation),
    idempotencyKey: normalizeRequiredString(request.idempotencyKey, 'Idempotency key'),
    payload: normalizeRecord(request.payload, 'payload'),
    client: normalizeClientInfo(request.client),
  };
}

function normalizeEntityType(value: unknown): SyncEntityType {
  if (value === 'knowledge_base' || value === 'card' || value === 'document' || value === 'graph_layout') {
    return value;
  }

  throw new AppException(422, 'VALIDATION_ERROR', 'Unsupported sync entity type');
}

function normalizeOperation(value: unknown): SyncOperation {
  if (value === 'create' || value === 'update' || value === 'delete' || value === 'restore') {
    return value;
  }

  throw new AppException(422, 'VALIDATION_ERROR', 'Unsupported sync operation');
}

function normalizeBaseVersion(value: unknown, operation: unknown): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppException(422, 'VALIDATION_ERROR', 'baseVersion must be a non-negative integer');
  }

  if (operation === 'create' && parsed !== 0) {
    throw new AppException(422, 'VALIDATION_ERROR', 'Create requests must use baseVersion = 0');
  }

  if (operation !== 'create' && parsed < 1) {
    throw new AppException(
      422,
      'VALIDATION_ERROR',
      'Update, delete and restore requests must use baseVersion >= 1',
    );
  }

  return parsed;
}

function normalizeClientInfo(value: unknown): SyncClientInfo | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new AppException(422, 'VALIDATION_ERROR', 'client must be an object');
  }

  const client = value as Record<string, unknown>;

  return {
    deviceId: normalizeOptionalString(client.deviceId),
    requestId: normalizeOptionalString(client.requestId),
    sentAt: normalizeOptionalString(client.sentAt),
  };
}

function normalizeKnowledgeBaseCreatePayload(payload: Record<string, unknown>) {
  return {
    name: normalizeRequiredString(payload.name, 'name'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder') ?? 0,
    coverAttachmentId: normalizeNullableUuid(payload.coverAttachmentId, 'coverAttachmentId'),
    description: normalizeNullableString(payload.description),
    settingsJson: normalizeJsonRecord(payload.settingsJson, 'settingsJson') ?? {},
  };
}

function normalizeKnowledgeBaseUpdatePayload(payload: Record<string, unknown>) {
  return {
    name: normalizeOptionalNonEmptyString(payload.name, 'name'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder'),
    coverAttachmentId: normalizeNullableUuidOrUndefined(payload.coverAttachmentId, 'coverAttachmentId'),
    description: normalizeNullableStringOrUndefined(payload.description),
    settingsJson: normalizeJsonRecord(payload.settingsJson, 'settingsJson'),
  };
}

function normalizeCardCreatePayload(payload: Record<string, unknown>) {
  return {
    kbId: normalizeUuid(payload.kbId, 'kbId'),
    parentId: normalizeNullableUuid(payload.parentId, 'parentId'),
    name: normalizeRequiredString(payload.name, 'name'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder') ?? 0,
    status: normalizeCardStatus(payload.status) ?? 'active',
    metaJson: normalizeJsonRecord(payload.metaJson, 'metaJson') ?? {},
  };
}

function normalizeCardUpdatePayload(payload: Record<string, unknown>) {
  return {
    kbId: normalizeOptionalUuid(payload.kbId, 'kbId'),
    parentId: normalizeNullableUuidOrUndefined(payload.parentId, 'parentId'),
    name: normalizeOptionalNonEmptyString(payload.name, 'name'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder'),
    status: normalizeCardStatus(payload.status),
    metaJson: normalizeJsonRecord(payload.metaJson, 'metaJson'),
  };
}

function normalizeDocumentCreatePayload(payload: Record<string, unknown>) {
  return {
    cardId: normalizeUuid(payload.cardId, 'cardId'),
    type: normalizeDocumentType(payload.type),
    title: normalizeRequiredString(payload.title, 'title'),
    parentDocumentId: normalizeNullableUuid(payload.parentDocumentId, 'parentDocumentId'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder') ?? 0,
    schemaVersion: normalizePositiveInteger(payload.schemaVersion, 'schemaVersion') ?? 1,
    contentJson: normalizeJsonRecord(payload.contentJson, 'contentJson') ?? {},
    metaJson: normalizeJsonRecord(payload.metaJson, 'metaJson') ?? {},
  };
}

function normalizeDocumentUpdatePayload(payload: Record<string, unknown>) {
  return {
    cardId: normalizeOptionalUuid(payload.cardId, 'cardId'),
    type: normalizeOptionalDocumentType(payload.type),
    title: normalizeOptionalNonEmptyString(payload.title, 'title'),
    parentDocumentId: normalizeNullableUuidOrUndefined(payload.parentDocumentId, 'parentDocumentId'),
    sortOrder: normalizeOptionalNonNegativeInteger(payload.sortOrder, 'sortOrder'),
    schemaVersion: normalizePositiveInteger(payload.schemaVersion, 'schemaVersion'),
    contentJson: normalizeJsonRecord(payload.contentJson, 'contentJson'),
    metaJson: normalizeJsonRecord(payload.metaJson, 'metaJson'),
  };
}

function normalizeGraphLayoutCreatePayload(payload: Record<string, unknown>) {
  return {
    kbId: normalizeUuid(payload.kbId, 'kbId'),
    roomCardId: normalizeNullableUuid(payload.roomCardId, 'roomCardId'),
    layoutJson: normalizeJsonRecord(payload.layoutJson, 'layoutJson') ?? {},
    viewportJson: normalizeJsonRecord(payload.viewportJson, 'viewportJson') ?? {},
  };
}

function normalizeGraphLayoutUpdatePayload(payload: Record<string, unknown>) {
  return {
    kbId: normalizeOptionalUuid(payload.kbId, 'kbId'),
    roomCardId: normalizeNullableUuidOrUndefined(payload.roomCardId, 'roomCardId'),
    layoutJson: normalizeJsonRecord(payload.layoutJson, 'layoutJson'),
    viewportJson: normalizeJsonRecord(payload.viewportJson, 'viewportJson'),
  };
}

function normalizeUuid(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} is required`);
  }

  const normalized = value.trim();

  if (!UUID_PATTERN.test(normalized)) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} must be a valid UUID`);
  }

  return normalized;
}

function normalizeOptionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeUuid(value, label);
}

function normalizeNullableUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeUuid(value, label);
}

function normalizeNullableUuidOrUndefined(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeNullableUuid(value, label);
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} is required`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} cannot be empty`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', 'client fields must be strings');
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredString(value, label);
}

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', 'description must be a string');
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeNullableStringOrUndefined(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeNullableString(value);
}

function normalizeOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} must be a non-negative integer`);
  }

  return parsed;
}

function normalizePositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} must be a positive integer`);
  }

  return parsed;
}

function normalizeJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function normalizeRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new AppException(422, 'VALIDATION_ERROR', `${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function normalizeCardStatus(value: unknown): 'active' | 'archived' | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'active' || value === 'archived') {
    return value;
  }

  throw new AppException(422, 'VALIDATION_ERROR', 'status must be active or archived');
}

function normalizeDocumentType(value: unknown): 'smart' | 'mindmap' | 'flowchart' {
  if (value === 'smart' || value === 'mindmap' || value === 'flowchart') {
    return value;
  }

  throw new AppException(422, 'VALIDATION_ERROR', 'type must be smart, mindmap or flowchart');
}

function normalizeOptionalDocumentType(
  value: unknown,
): 'smart' | 'mindmap' | 'flowchart' | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeDocumentType(value);
}

function ensureCreateVersion(baseVersion: number): void {
  if (baseVersion !== 0) {
    throw new AppException(422, 'VALIDATION_ERROR', 'Create requests must use baseVersion = 0');
  }
}

function ensureEntityExists<T>(value: T | null, entityType: SyncEntityType, entityId: string): T {
  if (value) {
    return value;
  }

  throw new AppException(404, 'ENTITY_NOT_FOUND', 'Entity does not exist', {
    entityType,
    entityId,
  });
}

function ensureNotDeleted(
  deletedAt: Date | null,
  entityType: SyncEntityType,
  entityId: string,
): void {
  if (!deletedAt) {
    return;
  }

  throw new AppException(409, 'ENTITY_DELETED', 'Entity is deleted and must be restored first', {
    entityType,
    entityId,
  });
}

function ensureCanDelete(
  deletedAt: Date | null,
  entityType: SyncEntityType,
  entityId: string,
): void {
  if (!deletedAt) {
    return;
  }

  throw new AppException(409, 'ENTITY_ALREADY_DELETED', 'Entity is already deleted', {
    entityType,
    entityId,
  });
}

function ensureCanRestore(
  deletedAt: Date | null,
  entityType: SyncEntityType,
  entityId: string,
): void {
  if (deletedAt) {
    return;
  }

  throw new AppException(409, 'ENTITY_NOT_DELETED', 'Entity is not deleted', {
    entityType,
    entityId,
  });
}

function mapKnowledgeBaseRow(row: KnowledgeBaseRow): Record<string, unknown> {
  return {
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
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

function mapCardRow(row: CardRow): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kbId: row.kb_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    status: row.status,
    metaJson: asObject(row.meta_json),
    version: toSafeInteger(row.version, 'card version'),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

function mapDocumentRow(row: DocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    type: row.type,
    title: row.title,
    parentDocumentId: row.parent_document_id,
    sortOrder: row.sort_order,
    schemaVersion: row.schema_version,
    contentJson: asObject(row.content_json),
    metaJson: asObject(row.meta_json),
    version: toSafeInteger(row.version, 'document version'),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

function mapGraphLayoutRow(row: GraphLayoutRow): Record<string, unknown> {
  return {
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
  };
}

function toWriteResult(
  entityType: SyncEntityType,
  eventType: SyncWriteResult['eventType'],
  entitySnapshot: Record<string, unknown>,
): SyncWriteResult {
  return {
    entityType,
    entityId: entitySnapshot.id as string,
    eventType,
    entityVersion: entitySnapshot.version as number,
    entitySnapshot,
  };
}

function toSafeInteger(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}`);
  }

  return parsed;
}

function asObject(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickDefined<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  const constraint = (error as { constraint?: string }).constraint;

  return (
    isUniqueViolation(error) &&
    (constraint === 'idx_idempotency_workspace_scope_key_unique' ||
      constraint === 'idx_idempotency_global_scope_key_unique' ||
      constraint === 'idx_idempotency_scope_key_unique')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === '23505';
}

function mapUniqueViolation(error: unknown): AppException {
  const constraint = (error as { constraint?: string }).constraint;

  if (
    constraint === 'idx_graph_layouts_kb_room_unique' ||
    constraint === 'idx_graph_layouts_kb_root_unique'
  ) {
    return new AppException(
      409,
      'LAYOUT_ALREADY_EXISTS',
      'Graph layout already exists for the requested room scope',
    );
  }

  return new AppException(409, 'CONSTRAINT_VIOLATION', 'Request violates a unique constraint');
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
