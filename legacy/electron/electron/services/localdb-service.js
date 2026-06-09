import nodeFs from 'fs';
import nodePath from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import BetterSqlite3 from 'better-sqlite3';

const CURRENT_DIR = nodePath.dirname(fileURLToPath(import.meta.url));
const SOURCE_MIGRATIONS_DIR = nodePath.join(CURRENT_DIR, '..', 'migrations', 'localdb');
const DOCUMENT_PATH_SUFFIX_BY_TYPE = {
  smart: '.tdoc.json',
  mindmap: '.tmind.json',
  flowchart: '.tflow.json',
};

export function createLocalDbService(options = {}) {
  const getUserDataPath =
    typeof options.getUserDataPath === 'function'
      ? options.getUserDataPath
      : () => {
          throw new Error('getUserDataPath is required');
        };

  let db = null;

  function getPaths() {
    const rootDir = nodePath.join(getUserDataPath(), 'storage');
    return {
      rootDir,
      dbPath: nodePath.join(rootDir, 'topo-cache.db'),
      runtimeMigrationsDir: nodePath.join(rootDir, 'migrations'),
      sourceMigrationsDir: SOURCE_MIGRATIONS_DIR,
    };
  }

  function ensureDirectories(paths = getPaths()) {
    nodeFs.mkdirSync(paths.rootDir, { recursive: true });
    nodeFs.mkdirSync(paths.runtimeMigrationsDir, { recursive: true });
  }

  function copyMigrationArtifacts(paths) {
    const sourceFiles = listMigrationFiles(paths.sourceMigrationsDir);
    for (const fileName of sourceFiles) {
      const sourcePath = nodePath.join(paths.sourceMigrationsDir, fileName);
      const targetPath = nodePath.join(paths.runtimeMigrationsDir, fileName);
      if (!nodeFs.existsSync(targetPath)) {
        nodeFs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  function open() {
    if (db) {
      return db;
    }

    const paths = getPaths();
    ensureDirectories(paths);
    copyMigrationArtifacts(paths);

    db = new BetterSqlite3(paths.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    applyMigrations(db, paths.runtimeMigrationsDir);
    return db;
  }

  function init() {
    open();
    return healthCheck();
  }

  function close() {
    if (db) {
      db.close();
      db = null;
    }
  }

  function healthCheck() {
    const database = open();
    const paths = getPaths();
    const migrationCount =
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count ?? 0;
    const journalMode =
      database.prepare('PRAGMA journal_mode').pluck().get() ?? 'unknown';

    return {
      ready: true,
      paths,
      migrationCount,
      journalMode,
      tables: database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
        .all()
        .map((row) => row.name),
    };
  }

  function getWorkspaceSnapshot(workspaceId) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    const workspace = database
      .prepare(
        `
          SELECT
            id,
            name,
            role,
            server_updated_at,
            last_bootstrap_at,
            last_opened_at,
            bootstrap_version,
            archived_at
          FROM local_workspaces
          WHERE id = ?
        `,
      )
      .get(normalizedWorkspaceId);
    const cursor = database
      .prepare(
        `
          SELECT
            workspace_id,
            last_event_id,
            bootstrap_completed_at,
            last_pull_at,
            last_push_at,
            server_time_at_last_pull
          FROM sync_cursor
          WHERE workspace_id = ?
        `,
      )
      .get(normalizedWorkspaceId);
    const config = database
      .prepare(
        `
          SELECT
            workspace_id,
            config_version,
            config_json,
            updated_at,
            last_event_id,
            synced_at
          FROM local_workspace_configs
          WHERE workspace_id = ?
        `,
      )
      .get(normalizedWorkspaceId);

    return {
      workspace: workspace ? mapWorkspaceRow(workspace) : null,
      cursor: mapCursorRow(cursor),
      config: mapWorkspaceConfigRow(config),
      knowledgeBases: listKnowledgeBases(normalizedWorkspaceId),
      cards: listCardsByWorkspace(database, normalizedWorkspaceId),
      documents: listDocumentsByWorkspace(database, normalizedWorkspaceId),
      graphLayouts: listGraphLayoutsByWorkspace(database, normalizedWorkspaceId),
      attachments: listAttachmentsByWorkspace(database, normalizedWorkspaceId),
    };
  }

  function applyBootstrap(snapshot) {
    const database = open();
    const normalized = normalizeBootstrapSnapshot(snapshot);
    const syncedAt = new Date().toISOString();

    const apply = database.transaction((payload, appliedAt) => {
      const existingWorkspace = database
        .prepare(
          `
            SELECT last_opened_at
            FROM local_workspaces
            WHERE id = ?
          `,
        )
        .get(payload.workspace.id);

      database
        .prepare(
          `
            INSERT INTO local_workspaces (
              id,
              name,
              role,
              server_updated_at,
              last_bootstrap_at,
              last_opened_at,
              bootstrap_version,
              archived_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              role = excluded.role,
              server_updated_at = excluded.server_updated_at,
              last_bootstrap_at = excluded.last_bootstrap_at,
              last_opened_at = COALESCE(local_workspaces.last_opened_at, excluded.last_opened_at),
              bootstrap_version = excluded.bootstrap_version,
              archived_at = excluded.archived_at
          `,
        )
        .run(
          payload.workspace.id,
          payload.workspace.name,
          payload.workspace.role,
          payload.workspace.updatedAt,
          appliedAt,
          existingWorkspace?.last_opened_at ?? null,
          1,
          null,
        );

      database
        .prepare(
          `
            INSERT INTO local_workspace_configs (
              workspace_id,
              config_version,
              config_json,
              updated_at,
              last_event_id,
              synced_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              config_version = excluded.config_version,
              config_json = excluded.config_json,
              updated_at = excluded.updated_at,
              last_event_id = excluded.last_event_id,
              synced_at = excluded.synced_at
          `,
        )
        .run(
          payload.workspace.id,
          payload.config.version,
          stringifyJson(payload.config.configJson),
          payload.config.updatedAt,
          payload.cursor.lastEventId,
          appliedAt,
        );

      database.prepare('DELETE FROM local_knowledge_bases WHERE workspace_id = ?').run(payload.workspace.id);
      database.prepare('DELETE FROM local_cards WHERE workspace_id = ?').run(payload.workspace.id);
      database.prepare('DELETE FROM local_documents WHERE workspace_id = ?').run(payload.workspace.id);
      database.prepare('DELETE FROM local_graph_layouts WHERE workspace_id = ?').run(payload.workspace.id);
      database.prepare('DELETE FROM local_attachments WHERE workspace_id = ?').run(payload.workspace.id);

      const insertKnowledgeBase = database.prepare(
        `
          INSERT INTO local_knowledge_bases (
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const row of payload.knowledgeBases) {
        insertKnowledgeBase.run(
          row.id,
          row.workspaceId,
          row.name,
          row.sortOrder,
          row.coverAttachmentId,
          row.description,
          stringifyJson(row.settingsJson),
          row.version,
          row.createdAt,
          row.updatedAt,
          row.deletedAt,
          payload.cursor.lastEventId,
          appliedAt,
          'clean',
        );
      }

      const insertCard = database.prepare(
        `
          INSERT INTO local_cards (
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const row of payload.cards) {
        insertCard.run(
          row.id,
          row.workspaceId,
          row.kbId,
          row.parentId,
          row.name,
          row.sortOrder,
          row.status,
          stringifyJson(row.metaJson),
          row.version,
          row.createdAt,
          row.updatedAt,
          row.deletedAt,
          payload.cursor.lastEventId,
          appliedAt,
          'clean',
        );
      }

      const insertDocument = database.prepare(
        `
          INSERT INTO local_documents (
            id,
            workspace_id,
            card_id,
            type,
            title,
            file_name,
            parent_document_id,
            sort_order,
            schema_version,
            content_json,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const row of payload.documents) {
        insertDocument.run(
          row.id,
          row.workspaceId,
          row.cardId,
          row.type,
          row.title,
          row.fileName,
          row.parentDocumentId,
          row.sortOrder,
          row.schemaVersion,
          stringifyJson(row.contentJson),
          stringifyJson(row.metaJson),
          row.version,
          row.createdAt,
          row.updatedAt,
          row.deletedAt,
          payload.cursor.lastEventId,
          appliedAt,
          'clean',
        );
      }

      const insertGraphLayout = database.prepare(
        `
          INSERT INTO local_graph_layouts (
            id,
            workspace_id,
            kb_id,
            room_card_id,
            layout_json,
            viewport_json,
            version,
            updated_by,
            created_at,
            updated_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const row of payload.graphLayouts) {
        insertGraphLayout.run(
          row.id,
          row.workspaceId,
          row.kbId,
          row.roomCardId,
          stringifyJson(row.layoutJson),
          stringifyJson(row.viewportJson),
          row.version,
          row.updatedBy,
          row.createdAt,
          row.updatedAt,
          payload.cursor.lastEventId,
          appliedAt,
          'clean',
        );
      }

      const insertAttachment = database.prepare(
        `
          INSERT INTO local_attachments (
            id,
            workspace_id,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            storage_provider,
            storage_bucket,
            storage_key,
            sha256,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const row of payload.attachments) {
        insertAttachment.run(
          row.id,
          row.workspaceId,
          row.knowledgeBaseId,
          row.cardId,
          row.documentId,
          row.fileName,
          row.mimeType,
          row.sizeBytes,
          row.storageProvider,
          row.storageBucket,
          row.storageKey,
          row.sha256,
          stringifyJson(row.metaJson),
          row.version,
          row.createdAt,
          row.updatedAt,
          row.deletedAt,
          payload.cursor.lastEventId,
          appliedAt,
          'clean',
        );
      }

      database
        .prepare(
          `
            INSERT INTO sync_cursor (
              workspace_id,
              last_event_id,
              bootstrap_completed_at,
              last_pull_at,
              last_push_at,
              server_time_at_last_pull
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              last_event_id = excluded.last_event_id,
              bootstrap_completed_at = excluded.bootstrap_completed_at,
              last_pull_at = excluded.last_pull_at,
              server_time_at_last_pull = excluded.server_time_at_last_pull
          `,
        )
        .run(
          payload.workspace.id,
          payload.cursor.lastEventId,
          appliedAt,
          appliedAt,
          null,
          null,
        );
    });

    apply(normalized, syncedAt);
    return getWorkspaceSnapshot(normalized.workspace.id);
  }

  function applySyncPull(payload) {
    const database = open();
    const normalized = normalizeSyncPullPayload(payload);
    const syncedAt = new Date().toISOString();

    const apply = database.transaction((syncPayload, appliedAt) => {
      const existingCursor = database
        .prepare(
          `
            SELECT bootstrap_completed_at, last_push_at
            FROM sync_cursor
            WHERE workspace_id = ?
          `,
        )
        .get(syncPayload.workspaceId);

      const upsertKnowledgeBase = database.prepare(
        `
          INSERT INTO local_knowledge_bases (
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            name = excluded.name,
            sort_order = excluded.sort_order,
            cover_attachment_id = excluded.cover_attachment_id,
            description = excluded.description,
            settings_json = excluded.settings_json,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            last_event_id = excluded.last_event_id,
            synced_at = excluded.synced_at,
            dirty_state = excluded.dirty_state
        `,
      );
      const upsertCard = database.prepare(
        `
          INSERT INTO local_cards (
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            kb_id = excluded.kb_id,
            parent_id = excluded.parent_id,
            name = excluded.name,
            sort_order = excluded.sort_order,
            status = excluded.status,
            meta_json = excluded.meta_json,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            last_event_id = excluded.last_event_id,
            synced_at = excluded.synced_at,
            dirty_state = excluded.dirty_state
        `,
      );
      const upsertDocument = database.prepare(
        `
          INSERT INTO local_documents (
            id,
            workspace_id,
            card_id,
            type,
            title,
            file_name,
            parent_document_id,
            sort_order,
            schema_version,
            content_json,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            card_id = excluded.card_id,
            type = excluded.type,
            title = excluded.title,
            file_name = excluded.file_name,
            parent_document_id = excluded.parent_document_id,
            sort_order = excluded.sort_order,
            schema_version = excluded.schema_version,
            content_json = excluded.content_json,
            meta_json = excluded.meta_json,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            last_event_id = excluded.last_event_id,
            synced_at = excluded.synced_at,
            dirty_state = excluded.dirty_state
        `,
      );
      const upsertGraphLayout = database.prepare(
        `
          INSERT INTO local_graph_layouts (
            id,
            workspace_id,
            kb_id,
            room_card_id,
            layout_json,
            viewport_json,
            version,
            updated_by,
            created_at,
            updated_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            kb_id = excluded.kb_id,
            room_card_id = excluded.room_card_id,
            layout_json = excluded.layout_json,
            viewport_json = excluded.viewport_json,
            version = excluded.version,
            updated_by = excluded.updated_by,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            last_event_id = excluded.last_event_id,
            synced_at = excluded.synced_at,
            dirty_state = excluded.dirty_state
        `,
      );
      const upsertAttachment = database.prepare(
        `
          INSERT INTO local_attachments (
            id,
            workspace_id,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            storage_provider,
            storage_bucket,
            storage_key,
            sha256,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            knowledge_base_id = excluded.knowledge_base_id,
            card_id = excluded.card_id,
            document_id = excluded.document_id,
            file_name = excluded.file_name,
            mime_type = excluded.mime_type,
            size_bytes = excluded.size_bytes,
            storage_provider = excluded.storage_provider,
            storage_bucket = excluded.storage_bucket,
            storage_key = excluded.storage_key,
            sha256 = excluded.sha256,
            meta_json = excluded.meta_json,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            last_event_id = excluded.last_event_id,
            synced_at = excluded.synced_at,
            dirty_state = excluded.dirty_state
        `,
      );

      for (const event of syncPayload.events) {
        switch (event.entityType) {
          case 'knowledge_base':
            if (event.eventType === 'purged') {
              purgeKnowledgeBaseSubtreeLocally(database, event.payload.id);
              break;
            }
            upsertKnowledgeBase.run(
              event.payload.id,
              event.payload.workspaceId,
              event.payload.name,
              event.payload.sortOrder,
              event.payload.coverAttachmentId,
              event.payload.description,
              stringifyJson(event.payload.settingsJson),
              event.payload.version,
              event.payload.createdAt,
              event.payload.updatedAt,
              event.payload.deletedAt,
              event.id,
              appliedAt,
              'clean',
            );
            break;
          case 'card':
            if (event.eventType === 'purged') {
              purgeCardSubtreeLocally(database, event.payload.workspaceId, event.payload.id);
              break;
            }
            upsertCard.run(
              event.payload.id,
              event.payload.workspaceId,
              event.payload.kbId,
              event.payload.parentId,
              event.payload.name,
              event.payload.sortOrder,
              event.payload.status,
              stringifyJson(event.payload.metaJson),
              event.payload.version,
              event.payload.createdAt,
              event.payload.updatedAt,
              event.payload.deletedAt,
              event.id,
              appliedAt,
              'clean',
            );
            break;
          case 'document':
            if (event.eventType === 'purged') {
              database
                .prepare(
                  `
                    DELETE FROM local_documents
                    WHERE id = ?
                  `,
                )
                .run(event.payload.id);
              break;
            }
            upsertDocument.run(
              event.payload.id,
              event.payload.workspaceId,
              event.payload.cardId,
              event.payload.type,
              event.payload.title,
              event.payload.fileName,
              event.payload.parentDocumentId,
              event.payload.sortOrder,
              event.payload.schemaVersion,
              stringifyJson(event.payload.contentJson),
              stringifyJson(event.payload.metaJson),
              event.payload.version,
              event.payload.createdAt,
              event.payload.updatedAt,
              event.payload.deletedAt,
              event.id,
              appliedAt,
              'clean',
            );
            break;
          case 'graph_layout':
            upsertGraphLayout.run(
              event.payload.id,
              event.payload.workspaceId,
              event.payload.kbId,
              event.payload.roomCardId,
              stringifyJson(event.payload.layoutJson),
              stringifyJson(event.payload.viewportJson),
              event.payload.version,
              event.payload.updatedBy,
              event.payload.createdAt,
              event.payload.updatedAt,
              event.id,
              appliedAt,
              'clean',
            );
            break;
          case 'attachment':
            if (event.eventType === 'purged') {
              database
                .prepare(
                  `
                    DELETE FROM local_attachments
                    WHERE id = ?
                  `,
                )
                .run(event.payload.id);
              break;
            }
            upsertAttachment.run(
              event.payload.id,
              event.payload.workspaceId,
              event.payload.knowledgeBaseId,
              event.payload.cardId,
              event.payload.documentId,
              event.payload.fileName,
              event.payload.mimeType,
              event.payload.sizeBytes,
              event.payload.storageProvider,
              event.payload.storageBucket,
              event.payload.storageKey,
              event.payload.sha256,
              stringifyJson(event.payload.metaJson),
              event.payload.version,
              event.payload.createdAt,
              event.payload.updatedAt,
              event.payload.deletedAt,
              event.id,
              appliedAt,
              'clean',
            );
            break;
          default:
            throw new Error(`Unsupported sync entity type: ${String(event.entityType)}`);
        }
      }

      database
        .prepare(
          `
            INSERT INTO sync_cursor (
              workspace_id,
              last_event_id,
              bootstrap_completed_at,
              last_pull_at,
              last_push_at,
              server_time_at_last_pull
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              last_event_id = CASE
                WHEN excluded.last_event_id > sync_cursor.last_event_id THEN excluded.last_event_id
                ELSE sync_cursor.last_event_id
              END,
              bootstrap_completed_at = COALESCE(sync_cursor.bootstrap_completed_at, excluded.bootstrap_completed_at),
              last_pull_at = excluded.last_pull_at,
              last_push_at = COALESCE(sync_cursor.last_push_at, excluded.last_push_at),
              server_time_at_last_pull = excluded.server_time_at_last_pull
          `,
        )
        .run(
          syncPayload.workspaceId,
          syncPayload.toEventId,
          existingCursor?.bootstrap_completed_at ?? null,
          appliedAt,
          existingCursor?.last_push_at ?? null,
          appliedAt,
        );
    });

    apply(normalized, syncedAt);
    return getWorkspaceSnapshot(normalized.workspaceId);
  }

  function applySyncPushResult(input) {
    const database = open();
    const normalized = normalizeSyncPushResultInput(input);
    const syncedAt = new Date().toISOString();

    const apply = database.transaction((pushResult, appliedAt) => {
      const outboxRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            FROM sync_outbox
            WHERE id = ?
          `,
        )
        .get(pushResult.outboxId);

      if (!outboxRow) {
        throw new Error(`Outbox item not found: ${pushResult.outboxId}`);
      }

      const existingCursor = database
        .prepare(
          `
            SELECT bootstrap_completed_at, last_pull_at
            FROM sync_cursor
            WHERE workspace_id = ?
          `,
        )
        .get(pushResult.workspaceId);

      switch (pushResult.result.entityType) {
        case 'knowledge_base':
          if (pushResult.result.operation === 'purge') {
            purgeKnowledgeBaseSubtreeLocally(database, pushResult.result.entity.id);
            break;
          }
          const currentKnowledgeBaseRow = database
            .prepare(
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
                  deleted_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_knowledge_bases
                WHERE id = ?
              `,
            )
            .get(pushResult.result.entity.id);
          const pushedKnowledgeBasePayload = parseJsonRecord(outboxRow.payload_json);
          const hasOtherPendingKnowledgeBaseOutbox = Boolean(
            database
              .prepare(
                `
                  SELECT 1
                  FROM sync_outbox
                  WHERE workspace_id = ?
                    AND entity_type = 'knowledge_base'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                  LIMIT 1
                `,
              )
              .get(pushResult.workspaceId, pushResult.result.entity.id, pushResult.outboxId),
          );

          if (
            currentKnowledgeBaseRow &&
            (hasOtherPendingKnowledgeBaseOutbox ||
              !knowledgeBaseRowMatchesOutboxPayload(
                currentKnowledgeBaseRow,
                pushedKnowledgeBasePayload,
              ))
          ) {
            database
              .prepare(
                `
                  UPDATE local_knowledge_bases
                  SET
                    version = ?,
                    last_event_id = ?,
                    synced_at = ?,
                    dirty_state = ?
                  WHERE id = ?
                `,
              )
              .run(
                pushResult.result.entity.version,
                pushResult.result.event.id,
                appliedAt,
                'pending_push',
                pushResult.result.entity.id,
              );

            database
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    base_version = ?,
                    updated_at = ?
                  WHERE workspace_id = ?
                    AND entity_type = 'knowledge_base'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                `,
              )
              .run(
                pushResult.result.entity.version,
                appliedAt,
                pushResult.workspaceId,
                pushResult.result.entity.id,
                pushResult.outboxId,
              );
          } else {
            database
              .prepare(
                `
                  INSERT INTO local_knowledge_bases (
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
                    deleted_at,
                    last_event_id,
                    synced_at,
                    dirty_state
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    name = excluded.name,
                    sort_order = excluded.sort_order,
                    cover_attachment_id = excluded.cover_attachment_id,
                    description = excluded.description,
                    settings_json = excluded.settings_json,
                    version = excluded.version,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    last_event_id = excluded.last_event_id,
                    synced_at = excluded.synced_at,
                    dirty_state = excluded.dirty_state
                `,
              )
              .run(
                pushResult.result.entity.id,
                pushResult.result.entity.workspaceId,
                pushResult.result.entity.name,
                pushResult.result.entity.sortOrder,
                pushResult.result.entity.coverAttachmentId,
                pushResult.result.entity.description,
                stringifyJson(pushResult.result.entity.settingsJson),
                pushResult.result.entity.version,
                pushResult.result.entity.createdAt,
                pushResult.result.entity.updatedAt,
                pushResult.result.entity.deletedAt,
                pushResult.result.event.id,
                appliedAt,
                'clean',
              );
          }
          break;
        case 'card':
          if (pushResult.result.operation === 'purge') {
            purgeCardSubtreeLocally(
              database,
              pushResult.result.entity.workspaceId,
              pushResult.result.entity.id,
            );
            break;
          }
          const currentCardRow = database
            .prepare(
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
                  deleted_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_cards
                WHERE id = ?
              `,
            )
            .get(pushResult.result.entity.id);
          const pushedCardPayload = parseJsonRecord(outboxRow.payload_json);
          const hasOtherPendingCardOutbox = Boolean(
            database
              .prepare(
                `
                  SELECT 1
                  FROM sync_outbox
                  WHERE workspace_id = ?
                    AND entity_type = 'card'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                  LIMIT 1
                `,
              )
              .get(pushResult.workspaceId, pushResult.result.entity.id, pushResult.outboxId),
          );

          if (
            currentCardRow &&
            (hasOtherPendingCardOutbox || !cardRowMatchesOutboxPayload(currentCardRow, pushedCardPayload))
          ) {
            database
              .prepare(
                `
                  UPDATE local_cards
                  SET
                    version = ?,
                    last_event_id = ?,
                    synced_at = ?,
                    dirty_state = ?
                  WHERE id = ?
                `,
              )
              .run(
                pushResult.result.entity.version,
                pushResult.result.event.id,
                appliedAt,
                'pending_push',
                pushResult.result.entity.id,
              );

            database
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    base_version = ?,
                    updated_at = ?
                  WHERE workspace_id = ?
                    AND entity_type = 'card'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                `,
              )
              .run(
                pushResult.result.entity.version,
                appliedAt,
                pushResult.workspaceId,
                pushResult.result.entity.id,
                pushResult.outboxId,
              );
          } else {
            database
              .prepare(
                `
                  INSERT INTO local_cards (
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
                    deleted_at,
                    last_event_id,
                    synced_at,
                    dirty_state
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    kb_id = excluded.kb_id,
                    parent_id = excluded.parent_id,
                    name = excluded.name,
                    sort_order = excluded.sort_order,
                    status = excluded.status,
                    meta_json = excluded.meta_json,
                    version = excluded.version,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    last_event_id = excluded.last_event_id,
                    synced_at = excluded.synced_at,
                    dirty_state = excluded.dirty_state
                `,
              )
              .run(
                pushResult.result.entity.id,
                pushResult.result.entity.workspaceId,
                pushResult.result.entity.kbId,
                pushResult.result.entity.parentId,
                pushResult.result.entity.name,
                pushResult.result.entity.sortOrder,
                pushResult.result.entity.status,
                stringifyJson(pushResult.result.entity.metaJson),
                pushResult.result.entity.version,
                pushResult.result.entity.createdAt,
                pushResult.result.entity.updatedAt,
                pushResult.result.entity.deletedAt,
                pushResult.result.event.id,
                appliedAt,
                'clean',
              );
          }
          break;
        case 'document':
          if (pushResult.result.operation === 'purge') {
            database
              .prepare(
                `
                  DELETE FROM local_documents
                  WHERE id = ?
                `,
              )
              .run(pushResult.result.entity.id);
            break;
          }
          const currentDocumentRow = database
            .prepare(
              `
                SELECT
                  id,
                  workspace_id,
                  card_id,
                  type,
                  title,
                  file_name,
                  parent_document_id,
                  sort_order,
                  schema_version,
                  content_json,
                  meta_json,
                  version,
                  created_at,
                  updated_at,
                  deleted_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_documents
                WHERE id = ?
              `,
            )
            .get(pushResult.result.entity.id);
          const pushedPayload = parseJsonRecord(outboxRow.payload_json);
          const hasOtherPendingDocumentOutbox = Boolean(
            database
              .prepare(
                `
                  SELECT 1
                  FROM sync_outbox
                  WHERE workspace_id = ?
                    AND entity_type = 'document'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                  LIMIT 1
                `,
              )
              .get(pushResult.workspaceId, pushResult.result.entity.id, pushResult.outboxId),
          );

          if (
            currentDocumentRow &&
            (hasOtherPendingDocumentOutbox ||
              !documentRowMatchesOutboxPayload(currentDocumentRow, pushedPayload))
          ) {
            database
              .prepare(
                `
                  UPDATE local_documents
                  SET
                    version = ?,
                    last_event_id = ?,
                    synced_at = ?,
                    dirty_state = ?
                  WHERE id = ?
                `,
              )
              .run(
                pushResult.result.entity.version,
                pushResult.result.event.id,
                appliedAt,
                'pending_push',
                pushResult.result.entity.id,
              );

            database
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    base_version = ?,
                    updated_at = ?
                  WHERE workspace_id = ?
                    AND entity_type = 'document'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                `,
              )
              .run(
                pushResult.result.entity.version,
                appliedAt,
                pushResult.workspaceId,
                pushResult.result.entity.id,
                pushResult.outboxId,
              );
          } else {
            database
              .prepare(
                `
                  INSERT INTO local_documents (
                    id,
                    workspace_id,
                    card_id,
                    type,
                    title,
                    file_name,
                    parent_document_id,
                    sort_order,
                    schema_version,
                    content_json,
                    meta_json,
                    version,
                    created_at,
                    updated_at,
                    deleted_at,
                    last_event_id,
                    synced_at,
                    dirty_state
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    card_id = excluded.card_id,
                    type = excluded.type,
                    title = excluded.title,
                    file_name = excluded.file_name,
                    parent_document_id = excluded.parent_document_id,
                    sort_order = excluded.sort_order,
                    schema_version = excluded.schema_version,
                    content_json = excluded.content_json,
                    meta_json = excluded.meta_json,
                    version = excluded.version,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    last_event_id = excluded.last_event_id,
                    synced_at = excluded.synced_at,
                    dirty_state = excluded.dirty_state
                `,
              )
              .run(
                pushResult.result.entity.id,
                pushResult.result.entity.workspaceId,
                pushResult.result.entity.cardId,
                pushResult.result.entity.type,
                pushResult.result.entity.title,
                pushResult.result.entity.fileName,
                pushResult.result.entity.parentDocumentId,
                pushResult.result.entity.sortOrder,
                pushResult.result.entity.schemaVersion,
                stringifyJson(pushResult.result.entity.contentJson),
                stringifyJson(pushResult.result.entity.metaJson),
                pushResult.result.entity.version,
                pushResult.result.entity.createdAt,
                pushResult.result.entity.updatedAt,
                pushResult.result.entity.deletedAt,
                pushResult.result.event.id,
                appliedAt,
                'clean',
              );
          }
          break;
        case 'graph_layout':
          const currentGraphLayoutRow = database
            .prepare(
              `
                SELECT
                  id,
                  workspace_id,
                  kb_id,
                  room_card_id,
                  layout_json,
                  viewport_json,
                  version,
                  updated_by,
                  created_at,
                  updated_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_graph_layouts
                WHERE id = ?
              `,
            )
            .get(pushResult.result.entity.id);
          const pushedGraphLayoutPayload = parseJsonRecord(outboxRow.payload_json);
          const hasOtherPendingGraphLayoutOutbox = Boolean(
            database
              .prepare(
                `
                  SELECT 1
                  FROM sync_outbox
                  WHERE workspace_id = ?
                    AND entity_type = 'graph_layout'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                  LIMIT 1
                `,
              )
              .get(pushResult.workspaceId, pushResult.result.entity.id, pushResult.outboxId),
          );

          if (
            currentGraphLayoutRow &&
            (
              hasOtherPendingGraphLayoutOutbox ||
              !graphLayoutRowMatchesOutboxPayload(currentGraphLayoutRow, pushedGraphLayoutPayload)
            )
          ) {
            database
              .prepare(
                `
                  UPDATE local_graph_layouts
                  SET
                    version = ?,
                    last_event_id = ?,
                    synced_at = ?,
                    dirty_state = ?
                  WHERE id = ?
                `,
              )
              .run(
                pushResult.result.entity.version,
                pushResult.result.event.id,
                appliedAt,
                'pending_push',
                pushResult.result.entity.id,
              );

            database
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    base_version = ?,
                    updated_at = ?
                  WHERE workspace_id = ?
                    AND entity_type = 'graph_layout'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                `,
              )
              .run(
                pushResult.result.entity.version,
                appliedAt,
                pushResult.workspaceId,
                pushResult.result.entity.id,
                pushResult.outboxId,
              );
          } else {
            database
              .prepare(
                `
                  INSERT INTO local_graph_layouts (
                    id,
                    workspace_id,
                    kb_id,
                    room_card_id,
                    layout_json,
                    viewport_json,
                    version,
                    updated_by,
                    created_at,
                    updated_at,
                    last_event_id,
                    synced_at,
                    dirty_state
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    kb_id = excluded.kb_id,
                    room_card_id = excluded.room_card_id,
                    layout_json = excluded.layout_json,
                    viewport_json = excluded.viewport_json,
                    version = excluded.version,
                    updated_by = excluded.updated_by,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    last_event_id = excluded.last_event_id,
                    synced_at = excluded.synced_at,
                    dirty_state = excluded.dirty_state
                `,
              )
              .run(
                pushResult.result.entity.id,
                pushResult.result.entity.workspaceId,
                pushResult.result.entity.kbId,
                pushResult.result.entity.roomCardId,
                stringifyJson(pushResult.result.entity.layoutJson),
                stringifyJson(pushResult.result.entity.viewportJson),
                pushResult.result.entity.version,
                pushResult.result.entity.updatedBy,
                pushResult.result.entity.createdAt,
                pushResult.result.entity.updatedAt,
                pushResult.result.event.id,
                appliedAt,
                'clean',
              );
          }
          break;
        case 'attachment':
          if (pushResult.result.operation === 'purge') {
            database
              .prepare(
                `
                  DELETE FROM local_attachments
                  WHERE id = ?
                `,
              )
              .run(pushResult.result.entity.id);
            break;
          }
          const currentAttachmentRow = database
            .prepare(
              `
                SELECT
                  id,
                  workspace_id,
                  knowledge_base_id,
                  card_id,
                  document_id,
                  file_name,
                  mime_type,
                  size_bytes,
                  storage_provider,
                  storage_bucket,
                  storage_key,
                  sha256,
                  meta_json,
                  version,
                  created_at,
                  updated_at,
                  deleted_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_attachments
                WHERE id = ?
              `,
            )
            .get(pushResult.result.entity.id);
          const pushedAttachmentPayload = parseJsonRecord(outboxRow.payload_json);
          const hasOtherPendingAttachmentOutbox = Boolean(
            database
              .prepare(
                `
                  SELECT 1
                  FROM sync_outbox
                  WHERE workspace_id = ?
                    AND entity_type = 'attachment'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                  LIMIT 1
                `,
              )
              .get(pushResult.workspaceId, pushResult.result.entity.id, pushResult.outboxId),
          );

          if (
            currentAttachmentRow &&
            (
              hasOtherPendingAttachmentOutbox ||
              !attachmentRowMatchesOutboxPayload(currentAttachmentRow, pushedAttachmentPayload)
            )
          ) {
            database
              .prepare(
                `
                  UPDATE local_attachments
                  SET
                    version = ?,
                    last_event_id = ?,
                    synced_at = ?,
                    dirty_state = ?
                  WHERE id = ?
                `,
              )
              .run(
                pushResult.result.entity.version,
                pushResult.result.event.id,
                appliedAt,
                'pending_push',
                pushResult.result.entity.id,
              );

            database
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    base_version = ?,
                    updated_at = ?
                  WHERE workspace_id = ?
                    AND entity_type = 'attachment'
                    AND entity_id = ?
                    AND id <> ?
                    AND status IN ('pending', 'sending', 'failed', 'conflicted')
                `,
              )
              .run(
                pushResult.result.entity.version,
                appliedAt,
                pushResult.workspaceId,
                pushResult.result.entity.id,
                pushResult.outboxId,
              );
          } else {
            database
              .prepare(
                `
                  INSERT INTO local_attachments (
                    id,
                    workspace_id,
                    knowledge_base_id,
                    card_id,
                    document_id,
                    file_name,
                    mime_type,
                    size_bytes,
                    storage_provider,
                    storage_bucket,
                    storage_key,
                    sha256,
                    meta_json,
                    version,
                    created_at,
                    updated_at,
                    deleted_at,
                    last_event_id,
                    synced_at,
                    dirty_state
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    knowledge_base_id = excluded.knowledge_base_id,
                    card_id = excluded.card_id,
                    document_id = excluded.document_id,
                    file_name = excluded.file_name,
                    mime_type = excluded.mime_type,
                    size_bytes = excluded.size_bytes,
                    storage_provider = excluded.storage_provider,
                    storage_bucket = excluded.storage_bucket,
                    storage_key = excluded.storage_key,
                    sha256 = excluded.sha256,
                    meta_json = excluded.meta_json,
                    version = excluded.version,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    last_event_id = excluded.last_event_id,
                    synced_at = excluded.synced_at,
                    dirty_state = excluded.dirty_state
                `,
              )
              .run(
                pushResult.result.entity.id,
                pushResult.result.entity.workspaceId,
                pushResult.result.entity.knowledgeBaseId,
                pushResult.result.entity.cardId,
                pushResult.result.entity.documentId,
                pushResult.result.entity.fileName,
                pushResult.result.entity.mimeType,
                pushResult.result.entity.sizeBytes,
                pushResult.result.entity.storageProvider,
                pushResult.result.entity.storageBucket,
                pushResult.result.entity.storageKey,
                pushResult.result.entity.sha256,
                stringifyJson(pushResult.result.entity.metaJson),
                pushResult.result.entity.version,
                pushResult.result.entity.createdAt,
                pushResult.result.entity.updatedAt,
                pushResult.result.entity.deletedAt,
                pushResult.result.event.id,
                appliedAt,
                'clean',
              );
          }
          break;
        default:
          throw new Error(`Unsupported sync push entity type: ${String(pushResult.result.entityType)}`);
      }

      database
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'done',
              acked_event_id = ?,
              next_retry_at = NULL,
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(pushResult.result.event.id, appliedAt, pushResult.outboxId);

      database
        .prepare(
          `
            INSERT INTO sync_cursor (
              workspace_id,
              last_event_id,
              bootstrap_completed_at,
              last_pull_at,
              last_push_at,
              server_time_at_last_pull
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              last_event_id = CASE
                WHEN excluded.last_event_id > sync_cursor.last_event_id THEN excluded.last_event_id
                ELSE sync_cursor.last_event_id
              END,
              bootstrap_completed_at = COALESCE(sync_cursor.bootstrap_completed_at, excluded.bootstrap_completed_at),
              last_pull_at = COALESCE(sync_cursor.last_pull_at, excluded.last_pull_at),
              last_push_at = excluded.last_push_at,
              server_time_at_last_pull = COALESCE(sync_cursor.server_time_at_last_pull, excluded.server_time_at_last_pull)
          `,
        )
        .run(
          pushResult.workspaceId,
          pushResult.result.event.id,
          existingCursor?.bootstrap_completed_at ?? null,
          existingCursor?.last_pull_at ?? null,
          appliedAt,
          null,
        );
    });

    apply(normalized, syncedAt);
    return getWorkspaceSnapshot(normalized.workspaceId);
  }

  function listPendingOutbox(workspaceId, limit) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    const normalizedLimit = normalizePositiveInteger(limit, 'limit', 50);
    const now = new Date().toISOString();

    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation,
            base_version,
            payload_json,
            idempotency_key,
            status,
            attempt_count,
            next_retry_at,
            last_error_code,
            last_error_message,
            acked_event_id,
            created_at,
            updated_at
          FROM sync_outbox
          WHERE workspace_id = ?
            AND status IN ('pending', 'sending', 'failed')
            AND (next_retry_at IS NULL OR next_retry_at <= ?)
          ORDER BY created_at ASC
          LIMIT ?
        `,
      )
      .all(normalizedWorkspaceId, now, normalizedLimit)
      .map(mapOutboxRow);
  }

  function markOutboxItemSending(outboxId) {
    const database = open();
    const normalizedOutboxId = normalizeId(outboxId, 'outboxId');
    const now = new Date().toISOString();

    const result = database
      .prepare(
        `
          UPDATE sync_outbox
          SET
            status = 'sending',
            attempt_count = attempt_count + 1,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, normalizedOutboxId);

    if (result.changes === 0) {
      throw new Error(`Outbox item not found: ${normalizedOutboxId}`);
    }
  }

  function markOutboxItemFailed(input) {
    const database = open();
    const normalizedOutboxId = normalizeId(input?.outboxId, 'outboxId');
    const now = new Date().toISOString();
    const nextRetryAt =
      typeof input?.nextRetryAt === 'string' && input.nextRetryAt.trim() ? input.nextRetryAt : null;
    const errorCode =
      typeof input?.errorCode === 'string' && input.errorCode.trim() ? input.errorCode.trim() : null;
    const errorMessage =
      typeof input?.errorMessage === 'string' && input.errorMessage.trim()
        ? input.errorMessage.trim()
        : null;

    const result = database
      .prepare(
        `
          UPDATE sync_outbox
          SET
            status = 'failed',
            next_retry_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(nextRetryAt, errorCode, errorMessage, now, normalizedOutboxId);

    if (result.changes === 0) {
      throw new Error(`Outbox item not found: ${normalizedOutboxId}`);
    }
  }

  function recordSyncPushConflict(input) {
    const database = open();
    const normalized = normalizeSyncPushConflictInput(input);
    const now = new Date().toISOString();

    const apply = database.transaction((conflictInput, recordedAt) => {
      const outboxRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            FROM sync_outbox
            WHERE id = ?
          `,
        )
        .get(conflictInput.outboxId);

      if (!outboxRow) {
        throw new Error(`Outbox item not found: ${conflictInput.outboxId}`);
      }
      if (outboxRow.workspace_id !== conflictInput.workspaceId) {
        throw new Error('sync conflict workspaceId does not match outbox workspace');
      }

      const existingConflict = database
        .prepare(
          `
            SELECT id, created_at
            FROM sync_conflicts
            WHERE outbox_id = ?
            LIMIT 1
          `,
        )
        .get(conflictInput.outboxId);

      database
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'conflicted',
              next_retry_at = NULL,
              last_error_code = ?,
              last_error_message = ?,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(
          conflictInput.errorCode,
          conflictInput.errorMessage,
          recordedAt,
          conflictInput.outboxId,
        );

      updateEntityDirtyState(
        database,
        outboxRow.entity_type,
        outboxRow.entity_id,
        'conflicted',
      );

      database
        .prepare(
          `
            INSERT INTO sync_conflicts (
              id,
              outbox_id,
              workspace_id,
              entity_type,
              entity_id,
              conflict_type,
              client_base_version,
              server_version,
              server_event_id,
              local_payload_json,
              server_entity_json,
              error_code,
              error_message,
              status,
              created_at,
              resolved_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)
            ON CONFLICT(outbox_id) DO UPDATE SET
              conflict_type = excluded.conflict_type,
              client_base_version = excluded.client_base_version,
              server_version = excluded.server_version,
              server_event_id = excluded.server_event_id,
              local_payload_json = excluded.local_payload_json,
              server_entity_json = excluded.server_entity_json,
              error_code = excluded.error_code,
              error_message = excluded.error_message,
              status = 'open',
              resolved_at = NULL,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          existingConflict?.id ?? randomUUID(),
          conflictInput.outboxId,
          conflictInput.workspaceId,
          outboxRow.entity_type,
          outboxRow.entity_id,
          conflictInput.conflictType,
          outboxRow.base_version,
          conflictInput.serverVersion,
          conflictInput.serverEventId,
          outboxRow.payload_json,
          stringifyJson(conflictInput.serverEntityJson),
          conflictInput.errorCode,
          conflictInput.errorMessage,
          existingConflict?.created_at ?? recordedAt,
          recordedAt,
        );
    });

    apply(normalized, now);
  }

  function listSyncConflicts(workspaceId, limit) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    const normalizedLimit = normalizePositiveInteger(limit, 'limit', 50);

    return database
      .prepare(
        `
          SELECT
            id,
            outbox_id,
            workspace_id,
            entity_type,
            entity_id,
            conflict_type,
            client_base_version,
            server_version,
            server_event_id,
            local_payload_json,
            server_entity_json,
            error_code,
            error_message,
            status,
            created_at,
            resolved_at,
            updated_at
          FROM sync_conflicts
          WHERE workspace_id = ?
          ORDER BY
            CASE
              WHEN status = 'open' THEN 0
              ELSE 1
            END,
            created_at DESC
          LIMIT ?
        `,
      )
      .all(normalizedWorkspaceId, normalizedLimit)
      .map(mapSyncConflictRow);
  }

  function getSyncDebugSnapshot(workspaceId) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    const cursorRow = database
      .prepare(
        `
          SELECT
            workspace_id,
            last_event_id,
            bootstrap_completed_at,
            last_pull_at,
            last_push_at,
            server_time_at_last_pull
          FROM sync_cursor
          WHERE workspace_id = ?
          LIMIT 1
        `,
      )
      .get(normalizedWorkspaceId);

    const outboxCountsRow = database
      .prepare(
        `
          SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS sending_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            SUM(CASE WHEN status = 'conflicted' THEN 1 ELSE 0 END) AS conflicted_count,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
            MIN(
              CASE
                WHEN status IN ('pending', 'sending', 'failed') THEN created_at
                ELSE NULL
              END
            ) AS oldest_pending_created_at,
            MIN(
              CASE
                WHEN next_retry_at IS NOT NULL THEN next_retry_at
                ELSE NULL
              END
            ) AS next_retry_at
          FROM sync_outbox
          WHERE workspace_id = ?
        `,
      )
      .get(normalizedWorkspaceId);

    const openConflictCountRow = database
      .prepare(
        `
          SELECT COUNT(*) AS open_conflict_count
          FROM sync_conflicts
          WHERE workspace_id = ?
            AND status = 'open'
        `,
      )
      .get(normalizedWorkspaceId);

    const recentOutbox = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation,
            base_version,
            payload_json,
            idempotency_key,
            status,
            attempt_count,
            next_retry_at,
            last_error_code,
            last_error_message,
            acked_event_id,
            created_at,
            updated_at
          FROM sync_outbox
          WHERE workspace_id = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 20
        `,
      )
      .all(normalizedWorkspaceId)
      .map(mapOutboxRow);

    const recentConflicts = database
      .prepare(
        `
          SELECT
            id,
            outbox_id,
            workspace_id,
            entity_type,
            entity_id,
            conflict_type,
            client_base_version,
            server_version,
            server_event_id,
            local_payload_json,
            server_entity_json,
            error_code,
            error_message,
            status,
            created_at,
            resolved_at,
            updated_at
          FROM sync_conflicts
          WHERE workspace_id = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 20
        `,
      )
      .all(normalizedWorkspaceId)
      .map(mapSyncConflictRow);

    return {
      workspaceId: normalizedWorkspaceId,
      cursor: mapCursorRow(cursorRow),
      outbox: {
        pendingCount: outboxCountsRow?.pending_count ?? 0,
        sendingCount: outboxCountsRow?.sending_count ?? 0,
        failedCount: outboxCountsRow?.failed_count ?? 0,
        conflictedCount: outboxCountsRow?.conflicted_count ?? 0,
        doneCount: outboxCountsRow?.done_count ?? 0,
        totalCount: outboxCountsRow?.total_count ?? 0,
        openConflictCount: openConflictCountRow?.open_conflict_count ?? 0,
        nextRetryAt: outboxCountsRow?.next_retry_at ?? null,
        oldestPendingCreatedAt: outboxCountsRow?.oldest_pending_created_at ?? null,
      },
      recentOutbox,
      recentConflicts,
    };
  }

  function listSyncDebugOutboxItems(input) {
    const database = open();
    const normalizedInput = normalizeSyncDebugOutboxListInput(input);
    const conditions = ['workspace_id = ?'];
    const values = [normalizedInput.workspaceId];

    if (normalizedInput.statuses.length > 0) {
      conditions.push(
        `status IN (${normalizedInput.statuses.map(() => '?').join(', ')})`,
      );
      values.push(...normalizedInput.statuses);
    }

    values.push(normalizedInput.limit);

    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation,
            base_version,
            payload_json,
            idempotency_key,
            status,
            attempt_count,
            next_retry_at,
            last_error_code,
            last_error_message,
            acked_event_id,
            created_at,
            updated_at
          FROM sync_outbox
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE
              WHEN status = 'sending' THEN 0
              WHEN status = 'failed' THEN 1
              WHEN status = 'conflicted' THEN 2
              WHEN status = 'pending' THEN 3
              ELSE 4
            END,
            updated_at DESC,
            created_at DESC
          LIMIT ?
        `,
      )
      .all(...values)
      .map(mapOutboxRow);
  }

  function listSyncDebugConflicts(input) {
    const database = open();
    const normalizedInput = normalizeSyncDebugConflictListInput(input);
    const conditions = ['workspace_id = ?'];
    const values = [normalizedInput.workspaceId];

    if (normalizedInput.statuses.length > 0) {
      conditions.push(
        `status IN (${normalizedInput.statuses.map(() => '?').join(', ')})`,
      );
      values.push(...normalizedInput.statuses);
    }

    values.push(normalizedInput.limit);

    return database
      .prepare(
        `
          SELECT
            id,
            outbox_id,
            workspace_id,
            entity_type,
            entity_id,
            conflict_type,
            client_base_version,
            server_version,
            server_event_id,
            local_payload_json,
            server_entity_json,
            error_code,
            error_message,
            status,
            created_at,
            resolved_at,
            updated_at
          FROM sync_conflicts
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE
              WHEN status = 'open' THEN 0
              WHEN status = 'resolved' THEN 1
              ELSE 2
            END,
            updated_at DESC,
            created_at DESC
          LIMIT ?
        `,
      )
      .all(...values)
      .map(mapSyncConflictRow);
  }

  function listSyncDebugAttachmentJobs(input) {
    const database = open();
    const normalizedInput = normalizeSyncDebugAttachmentJobListInput(input);
    const conditions = ['workspace_id = ?'];
    const values = [normalizedInput.workspaceId];

    if (normalizedInput.statuses.length > 0) {
      conditions.push(
        `status IN (${normalizedInput.statuses.map(() => '?').join(', ')})`,
      );
      values.push(...normalizedInput.statuses);
    }

    values.push(normalizedInput.limit);

    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          FROM attachment_upload_jobs
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE
              WHEN status = 'uploading' THEN 0
              WHEN status = 'failed' THEN 1
              WHEN status = 'pending' THEN 2
              WHEN status = 'uploaded' THEN 3
              WHEN status = 'committing' THEN 4
              WHEN status = 'done' THEN 5
              ELSE 6
            END,
            updated_at DESC,
            created_at DESC
          LIMIT ?
        `,
      )
      .all(...values)
      .map(mapAttachmentUploadJobRow);
  }

  function listImportAttachmentUploadJobs(input) {
    const database = open();
    const workspaceId = normalizeId(input?.workspaceId, 'listImportAttachmentUploadJobs.workspaceId');
    const importJobId = normalizeId(input?.importJobId, 'listImportAttachmentUploadJobs.importJobId');
    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          FROM attachment_upload_jobs
          WHERE workspace_id = ?
          ORDER BY updated_at DESC, created_at DESC
        `,
      )
      .all(workspaceId)
      .map(mapAttachmentUploadJobRow)
      .filter(
        (row) =>
          row.uploadTicketJson?.source === 'import:source_import_kb' &&
          row.uploadTicketJson?.importJobId === importJobId,
      );
  }

  function createAttachmentUploadJob(input) {
    const database = open();
    const normalized = normalizeCreateAttachmentUploadJobInput(input);
    const now = new Date().toISOString();
    const attachmentJobId = normalized.attachmentJobId ?? randomUUID();

    database
      .prepare(
        `
          INSERT INTO attachment_upload_jobs (
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
        `,
      )
      .run(
        attachmentJobId,
        normalized.workspaceId,
        normalized.localFilePath,
        normalized.knowledgeBaseId,
        normalized.cardId,
        normalized.documentId,
        normalized.fileName,
        normalized.mimeType,
        normalized.sizeBytes,
        stringifyJson(normalized.uploadTicketJson),
        normalized.storageKey,
        normalized.sha256,
        now,
        now,
      );

    return getAttachmentUploadJob(attachmentJobId);
  }

  function getAttachmentUploadJob(attachmentJobId) {
    const database = open();
    const normalizedAttachmentJobId = normalizeId(attachmentJobId, 'attachmentJobId');
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          FROM attachment_upload_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalizedAttachmentJobId);

    return row ? mapAttachmentUploadJobRow(row) : null;
  }

  function claimNextPendingAttachmentUploadJob() {
    const database = open();
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const row = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              local_file_path,
              knowledge_base_id,
              card_id,
              document_id,
              file_name,
              mime_type,
              size_bytes,
              upload_ticket_json,
              storage_key,
              sha256,
              status,
              attempt_count,
              last_error_code,
              last_error_message,
              created_at,
              updated_at
            FROM attachment_upload_jobs
            WHERE status = 'pending'
            ORDER BY updated_at ASC, created_at ASC
            LIMIT 1
          `,
        )
        .get();

      if (!row) {
        return null;
      }

      const updated = database
        .prepare(
          `
            UPDATE attachment_upload_jobs
            SET
              status = 'uploading',
              attempt_count = attempt_count + 1,
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = ?
            WHERE id = ?
              AND status = 'pending'
          `,
        )
        .run(now, row.id);

      if (!updated.changes) {
        return null;
      }

      return database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              local_file_path,
              knowledge_base_id,
              card_id,
              document_id,
              file_name,
              mime_type,
              size_bytes,
              upload_ticket_json,
              storage_key,
              sha256,
              status,
              attempt_count,
              last_error_code,
              last_error_message,
              created_at,
              updated_at
            FROM attachment_upload_jobs
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(row.id);
    });

    const nextRow = apply();
    return nextRow ? mapAttachmentUploadJobRow(nextRow) : null;
  }

  function markAttachmentUploadJobUploaded(input) {
    return updateAttachmentUploadJobLifecycle(input, 'uploaded');
  }

  function markAttachmentUploadJobCommitting(input) {
    return updateAttachmentUploadJobLifecycle(input, 'committing');
  }

  function completeAttachmentUploadJob(input) {
    return updateAttachmentUploadJobLifecycle(input, 'done');
  }

  function failAttachmentUploadJob(input) {
    return updateAttachmentUploadJobLifecycle(input, 'failed');
  }

  function updateAttachmentUploadJobLifecycle(input, nextStatus) {
    const database = open();
    const normalized = normalizeAttachmentUploadJobLifecycleInput(input, nextStatus);
    const now = new Date().toISOString();

    const existing = database
      .prepare(
        `
          SELECT
            id,
            upload_ticket_json,
            storage_key,
            sha256
          FROM attachment_upload_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.attachmentJobId);

    if (!existing) {
      throw new Error(`Attachment upload job not found: ${normalized.attachmentJobId}`);
    }

    const nextUploadTicketJson =
      normalized.uploadTicketJson === undefined
        ? parseJsonRecord(existing.upload_ticket_json)
        : normalized.uploadTicketJson;
    const nextStorageKey =
      normalized.storageKey === undefined ? existing.storage_key ?? null : normalized.storageKey;
    const nextSha256 =
      normalized.sha256 === undefined ? existing.sha256 ?? null : normalized.sha256;

    database
      .prepare(
        `
          UPDATE attachment_upload_jobs
          SET
            upload_ticket_json = ?,
            storage_key = ?,
            sha256 = ?,
            status = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        stringifyJson(nextUploadTicketJson),
        nextStorageKey,
        nextSha256,
        nextStatus,
        nextStatus === 'failed' ? normalized.lastErrorCode : null,
        nextStatus === 'failed' ? normalized.lastErrorMessage : null,
        now,
        normalized.attachmentJobId,
      );

    return getAttachmentUploadJob(normalized.attachmentJobId);
  }

  function listSyncDebugImportJobs(input) {
    const database = open();
    const normalizedInput = normalizeSyncDebugImportJobListInput(input);
    const conditions = ['workspace_id = ?'];
    const values = [normalizedInput.workspaceId];

    if (normalizedInput.statuses.length > 0) {
      conditions.push(
        `status IN (${normalizedInput.statuses.map(() => '?').join(', ')})`,
      );
      values.push(...normalizedInput.statuses);
    }

    values.push(normalizedInput.limit);

    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            source_path,
            stage,
            status,
            summary_json,
            report_path,
            created_at,
            updated_at
          FROM import_jobs
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE
              WHEN status = 'running' THEN 0
              WHEN status = 'failed' THEN 1
              WHEN status = 'pending' THEN 2
              WHEN status = 'done' THEN 3
              ELSE 4
            END,
            updated_at DESC,
            created_at DESC
          LIMIT ?
        `,
      )
      .all(...values)
      .map(mapImportJobRow);
  }

  function createImportJob(input) {
    const database = open();
    const normalized = normalizeCreateImportJobInput(input);
    const now = new Date().toISOString();
    const importJobId = normalized.importJobId ?? randomUUID();

    database
      .prepare(
        `
          INSERT INTO import_jobs (
            id,
            workspace_id,
            source_path,
            stage,
            status,
            summary_json,
            report_path,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `,
      )
      .run(
        importJobId,
        normalized.workspaceId,
        normalized.sourcePath,
        normalized.stage,
        stringifyJson(normalized.summaryJson),
        normalized.reportPath,
        now,
        now,
      );

    return getImportJob(importJobId);
  }

  function getImportJob(importJobId) {
    const database = open();
    const normalizedImportJobId = normalizeId(importJobId, 'importJobId');
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            source_path,
            stage,
            status,
            summary_json,
            report_path,
            created_at,
            updated_at
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalizedImportJobId);

    return row ? mapImportJobRow(row) : null;
  }

  function claimNextPendingImportJob() {
    const database = open();
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const row = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              source_path,
              stage,
              status,
              summary_json,
              report_path,
              created_at,
              updated_at
            FROM import_jobs
            WHERE status = 'pending'
            ORDER BY updated_at ASC, created_at ASC
            LIMIT 1
          `,
        )
        .get();

      if (!row) {
        return null;
      }

      const updated = database
        .prepare(
          `
            UPDATE import_jobs
            SET
              status = 'running',
              updated_at = ?
            WHERE id = ?
              AND status = 'pending'
          `,
        )
        .run(now, row.id);

      if (!updated.changes) {
        return null;
      }

      return database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              source_path,
              stage,
              status,
              summary_json,
              report_path,
              created_at,
              updated_at
            FROM import_jobs
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(row.id);
    });

    const nextRow = apply();
    return nextRow ? mapImportJobRow(nextRow) : null;
  }

  function completeImportJob(input) {
    return updateImportJobLifecycle(input, 'done');
  }

  function failImportJob(input) {
    return updateImportJobLifecycle(input, 'failed');
  }

  function updateImportJobProgress(input) {
    const database = open();
    const normalized = normalizeImportJobProgressInput(input);
    const now = new Date().toISOString();

    const existing = database
      .prepare(
        `
          SELECT
            id,
            summary_json,
            report_path
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.importJobId);

    if (!existing) {
      throw new Error(`Import job not found: ${normalized.importJobId}`);
    }

    const nextSummaryJson =
      normalized.summaryJson === undefined
        ? parseJsonRecord(existing.summary_json)
        : normalized.summaryJson;
    const nextReportPath =
      normalized.reportPath === undefined
        ? existing.report_path ?? null
        : normalized.reportPath;

    database
      .prepare(
        `
          UPDATE import_jobs
          SET
            stage = ?,
            summary_json = ?,
            report_path = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        normalized.stage,
        stringifyJson(nextSummaryJson),
        nextReportPath,
        now,
        normalized.importJobId,
      );

    return getImportJob(normalized.importJobId);
  }

  function updateImportJobLifecycle(input, nextStatus) {
    const database = open();
    const normalized = normalizeImportJobLifecycleInput(input, nextStatus);
    const now = new Date().toISOString();

    const existing = database
      .prepare(
        `
          SELECT id
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.importJobId);

    if (!existing) {
      throw new Error(`Import job not found: ${normalized.importJobId}`);
    }

    database
      .prepare(
        `
          UPDATE import_jobs
          SET
            stage = ?,
            status = ?,
            summary_json = ?,
            report_path = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        normalized.stage,
        nextStatus,
        stringifyJson(normalized.summaryJson),
        normalized.reportPath,
        now,
        normalized.importJobId,
      );

    return getImportJob(normalized.importJobId);
  }

  function requeueImportJob(input) {
    const database = open();
    const normalized = normalizeRequeueImportJobInput(input);
    const now = new Date().toISOString();

    const existing = database
      .prepare(
        `
          SELECT
            id,
            summary_json,
            report_path
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.importJobId);

    if (!existing) {
      throw new Error(`Import job not found: ${normalized.importJobId}`);
    }

    const nextSummaryJson =
      normalized.summaryJson === undefined
        ? parseJsonRecord(existing.summary_json)
        : normalized.summaryJson;
    const nextReportPath =
      normalized.reportPath === undefined
        ? existing.report_path ?? null
        : normalized.reportPath;

    database
      .prepare(
        `
          UPDATE import_jobs
          SET
            stage = ?,
            status = 'pending',
            summary_json = ?,
            report_path = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        normalized.stage,
        stringifyJson(nextSummaryJson),
        nextReportPath,
        now,
        normalized.importJobId,
      );

    return getImportJob(normalized.importJobId);
  }

  function getImportStructureOutboxState(input) {
    const database = open();
    const normalized = normalizeImportStructureOutboxStateInput(input);
    const statusByKey = {};
    const conditions = normalized.entityRefs.map(
      () => '(workspace_id = ? AND entity_type = ? AND entity_id = ?)',
    );
    const values = [];
    for (const entityRef of normalized.entityRefs) {
      values.push(normalized.workspaceId, entityRef.entityType, entityRef.entityId);
    }

    const rows = database
      .prepare(
        `
          SELECT
            workspace_id,
            entity_type,
            entity_id,
            operation,
            status,
            updated_at
          FROM sync_outbox
          WHERE ${conditions.join(' OR ')}
          ORDER BY updated_at DESC, created_at DESC
        `,
      )
      .all(...values);

    for (const entityRef of normalized.entityRefs) {
      statusByKey[`${entityRef.entityType}:${entityRef.entityId}`] = {
        entityType: entityRef.entityType,
        entityId: entityRef.entityId,
        status: 'clean',
        operation: null,
        updatedAt: null,
      };
    }

    for (const row of rows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      if (statusByKey[key]?.status !== 'clean') {
        continue;
      }
      const normalizedStatus = row.status === 'done' ? 'clean' : row.status;
      statusByKey[key] = {
        entityType: row.entity_type,
        entityId: row.entity_id,
        status: normalizedStatus,
        operation: row.operation,
        updatedAt: row.updated_at,
      };
    }

    const items = Object.values(statusByKey);
    return {
      workspaceId: normalized.workspaceId,
      items,
      summary: {
        totalCount: items.length,
        cleanCount: items.filter((item) => item.status === 'clean').length,
        pendingCount: items.filter((item) => item.status === 'pending').length,
        sendingCount: items.filter((item) => item.status === 'sending').length,
        failedCount: items.filter((item) => item.status === 'failed').length,
        conflictedCount: items.filter((item) => item.status === 'conflicted').length,
      },
    };
  }

  function retrySyncDebugAttachmentJob(input) {
    const database = open();
    const normalized = normalizeSyncDebugRetryAttachmentJobInput(input);
    const now = new Date().toISOString();
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          FROM attachment_upload_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.attachmentJobId);

    if (!row) {
      throw new Error(
        `Sync debug attachment upload job not found: ${normalized.attachmentJobId}`,
      );
    }
    if (row.status !== 'failed') {
      throw new Error(
        `Only failed attachment upload jobs can be retried: ${normalized.attachmentJobId}`,
      );
    }

    database
      .prepare(
        `
          UPDATE attachment_upload_jobs
          SET
            status = 'pending',
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, normalized.attachmentJobId);

    const nextRow = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            local_file_path,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            upload_ticket_json,
            storage_key,
            sha256,
            status,
            attempt_count,
            last_error_code,
            last_error_message,
            created_at,
            updated_at
          FROM attachment_upload_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.attachmentJobId);

    return mapAttachmentUploadJobRow(nextRow);
  }

  function resumeSyncDebugImportJob(input) {
    const database = open();
    const normalized = normalizeSyncDebugResumeImportJobInput(input);
    const now = new Date().toISOString();
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            source_path,
            stage,
            status,
            summary_json,
            report_path,
            created_at,
            updated_at
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.importJobId);

    if (!row) {
      throw new Error(`Sync debug import job not found: ${normalized.importJobId}`);
    }
    if (row.status !== 'failed') {
      throw new Error(`Only failed import jobs can be resumed: ${normalized.importJobId}`);
    }

    database
      .prepare(
        `
          UPDATE import_jobs
          SET
            status = 'pending',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, normalized.importJobId);

    const nextRow = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            source_path,
            stage,
            status,
            summary_json,
            report_path,
            created_at,
            updated_at
          FROM import_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.importJobId);

    return mapImportJobRow(nextRow);
  }

  function retrySyncDebugOutboxItem(input) {
    const database = open();
    const normalized = normalizeSyncDebugRetryOutboxInput(input);
    const now = new Date().toISOString();
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation,
            base_version,
            payload_json,
            idempotency_key,
            status,
            attempt_count,
            next_retry_at,
            last_error_code,
            last_error_message,
            acked_event_id,
            created_at,
            updated_at
          FROM sync_outbox
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.outboxId);

    if (!row) {
      throw new Error(`Sync debug outbox item not found: ${normalized.outboxId}`);
    }
    if (row.status !== 'failed') {
      throw new Error(`Only failed outbox items can be retried: ${normalized.outboxId}`);
    }

    database
      .prepare(
        `
          UPDATE sync_outbox
          SET
            status = 'pending',
            next_retry_at = NULL,
            last_error_code = NULL,
            last_error_message = NULL,
            acked_event_id = NULL,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, normalized.outboxId);

    updateEntityDirtyState(database, row.entity_type, row.entity_id, 'pending_push');

    const nextRow = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation,
            base_version,
            payload_json,
            idempotency_key,
            status,
            attempt_count,
            next_retry_at,
            last_error_code,
            last_error_message,
            acked_event_id,
            created_at,
            updated_at
          FROM sync_outbox
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalized.outboxId);

    return mapOutboxRow(nextRow);
  }

  function resolveSyncDebugConflictUseLocal(input) {
    const database = open();
    const normalized = normalizeSyncDebugResolveConflictUseLocalInput(input);
    const now = new Date().toISOString();

    const apply = database.transaction((conflictId, resolvedAt) => {
      const conflictRow = database
        .prepare(
          `
            SELECT
              id,
              outbox_id,
              workspace_id,
              entity_type,
              entity_id,
              conflict_type,
              client_base_version,
              server_version,
              server_event_id,
              local_payload_json,
              server_entity_json,
              error_code,
              error_message,
              status,
              created_at,
              resolved_at,
              updated_at
            FROM sync_conflicts
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(conflictId);

      if (!conflictRow) {
        throw new Error(`Sync debug conflict not found: ${conflictId}`);
      }
      if (conflictRow.status !== 'open') {
        throw new Error(`Only open conflicts can be retried with local payload: ${conflictId}`);
      }
      if (!Number.isSafeInteger(conflictRow.server_version) || conflictRow.server_version <= 0) {
        throw new Error(`Conflict serverVersion is required to retry locally: ${conflictId}`);
      }

      const outboxRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            FROM sync_outbox
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(conflictRow.outbox_id);

      if (!outboxRow) {
        throw new Error(`Conflict outbox item not found: ${conflictRow.outbox_id}`);
      }
      if (outboxRow.status !== 'conflicted') {
        throw new Error(`Conflict outbox item is not in conflicted state: ${conflictRow.outbox_id}`);
      }

      database
        .prepare(
          `
            UPDATE sync_conflicts
            SET
              status = 'resolved',
              resolved_at = ?,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(resolvedAt, resolvedAt, conflictId);

      database
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'pending',
              base_version = ?,
              next_retry_at = NULL,
              last_error_code = NULL,
              last_error_message = NULL,
              acked_event_id = NULL,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(conflictRow.server_version, resolvedAt, conflictRow.outbox_id);

      updateEntityDirtyState(database, outboxRow.entity_type, outboxRow.entity_id, 'pending_push');

      const nextConflictRow = database
        .prepare(
          `
            SELECT
              id,
              outbox_id,
              workspace_id,
              entity_type,
              entity_id,
              conflict_type,
              client_base_version,
              server_version,
              server_event_id,
              local_payload_json,
              server_entity_json,
              error_code,
              error_message,
              status,
              created_at,
              resolved_at,
              updated_at
            FROM sync_conflicts
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(conflictId);

      return mapSyncConflictRow(nextConflictRow);
    });

    return apply(normalized.conflictId, now);
  }

  function listKnowledgeBases(workspaceId) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    return database
      .prepare(
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_knowledge_bases
          WHERE workspace_id = ?
          ORDER BY sort_order ASC, updated_at DESC, created_at DESC
        `,
      )
      .all(normalizedWorkspaceId)
      .map(mapKnowledgeBaseRow);
  }

  function createKnowledgeBase(input) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(input?.workspaceId, 'workspaceId');
    const normalizedKnowledgeBaseId = normalizeId(input?.knowledgeBaseId, 'knowledgeBaseId');
    const normalizedName = normalizeString(input?.name, 'name');
    const normalizedSortOrder = normalizeNullableNonNegativeInteger(input?.sortOrder, 'sortOrder');
    const normalizedCoverAttachmentId = normalizeNullableId(
      input?.coverAttachmentId,
      'coverAttachmentId',
    );
    const normalizedDescription = normalizeNullableString(input?.description, 'description');
    const normalizedSettingsJson = normalizeRecord(input?.settingsJson, 'settingsJson', {});
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT id
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      if (existingRow) {
        throw new Error(`Knowledge base already exists locally: ${normalizedKnowledgeBaseId}`);
      }

      const workspaceRow = database
        .prepare(
          `
            SELECT id
            FROM local_workspaces
            WHERE id = ?
          `,
        )
        .get(normalizedWorkspaceId);

      if (!workspaceRow) {
        throw new Error(`Workspace not found: ${normalizedWorkspaceId}`);
      }

      const nextSortOrder =
        normalizedSortOrder ??
        database
          .prepare(
            `
              SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
              FROM local_knowledge_bases
              WHERE workspace_id = ?
                AND deleted_at IS NULL
            `,
          )
          .get(normalizedWorkspaceId).next_sort_order;

      const payload = {
        name: normalizedName,
        sortOrder: nextSortOrder,
        coverAttachmentId: normalizedCoverAttachmentId,
        description: normalizedDescription,
        settingsJson: normalizedSettingsJson,
      };

      database
        .prepare(
          `
            INSERT INTO local_knowledge_bases (
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 0, NULL, 'pending_push')
          `,
        )
        .run(
          normalizedKnowledgeBaseId,
          normalizedWorkspaceId,
          normalizedName,
          nextSortOrder,
          normalizedCoverAttachmentId,
          normalizedDescription,
          stringifyJson(normalizedSettingsJson),
          now,
          now,
        );

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'knowledge_base', ?, 'create', 0, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          normalizedWorkspaceId,
          normalizedKnowledgeBaseId,
          stringifyJson(payload),
          createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      return mapKnowledgeBaseRow(nextRow);
    });

    return apply();
  }

  function getKnowledgeBase(knowledgeBaseId) {
    const database = open();
    const normalizedKnowledgeBaseId = normalizeId(knowledgeBaseId, 'knowledgeBaseId');
    const row = database
      .prepare(
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_knowledge_bases
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(normalizedKnowledgeBaseId);

    return row ? mapKnowledgeBaseRow(row) : null;
  }

  function updateKnowledgeBase(input) {
    const database = open();
    const normalizedKnowledgeBaseId = normalizeId(input?.knowledgeBaseId, 'knowledgeBaseId');
    const normalizedName =
      input?.name === undefined ? undefined : normalizeString(input?.name, 'name');
    const normalizedCoverAttachmentId =
      input?.coverAttachmentId === undefined
        ? undefined
        : normalizeNullableId(input?.coverAttachmentId, 'coverAttachmentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              name,
              sort_order,
              cover_attachment_id,
              description,
              settings_json,
              version
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      if (!existingRow) {
        throw new Error(`Knowledge base not found: ${normalizedKnowledgeBaseId}`);
      }

      const nextName = normalizedName ?? existingRow.name;
      const nextCoverAttachmentId =
        normalizedCoverAttachmentId === undefined
          ? (existingRow.cover_attachment_id ?? null)
          : normalizedCoverAttachmentId;
      const nextPayload = {
        name: nextName,
        coverAttachmentId: nextCoverAttachmentId,
      };
      const reusableOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND operation = 'update'
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedKnowledgeBaseId);

      database
        .prepare(
          `
            UPDATE local_knowledge_bases
            SET
              name = ?,
              cover_attachment_id = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(nextName, nextCoverAttachmentId, now, 'pending_push', normalizedKnowledgeBaseId);

      if (reusableOutbox) {
        database
          .prepare(
            `
              UPDATE sync_outbox
              SET
                base_version = ?,
                payload_json = ?,
                idempotency_key = ?,
                status = 'pending',
                next_retry_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                acked_event_id = NULL,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
            now,
            reusableOutbox.id,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            'knowledge_base',
            normalizedKnowledgeBaseId,
            'update',
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      return mapKnowledgeBaseRow(nextRow);
    });

    return apply();
  }

  function deleteKnowledgeBase(input) {
    const database = open();
    const normalizedKnowledgeBaseId = normalizeId(input?.knowledgeBaseId, 'knowledgeBaseId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      if (!existingRow) {
        throw new Error(`Knowledge base not found: ${normalizedKnowledgeBaseId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedKnowledgeBaseId);

      if (sendingOutbox) {
        throw new Error(
          `Knowledge base is currently syncing and cannot be deleted: ${normalizedKnowledgeBaseId}`,
        );
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedKnowledgeBaseId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      if (existingRow.version === 0) {
        const hasPendingCreateOutbox = supersededOutboxes.some(
          (outbox) => outbox.operation === 'create',
        );
        if (!hasPendingCreateOutbox) {
          throw new Error(
            `Knowledge base cannot be deleted before initial sync: ${normalizedKnowledgeBaseId}`,
          );
        }

        database
          .prepare(
            `
              DELETE FROM local_knowledge_bases
              WHERE id = ?
            `,
          )
          .run(normalizedKnowledgeBaseId);

        return {
          id: existingRow.id,
          workspaceId: existingRow.workspace_id,
          name: existingRow.name,
          sortOrder: existingRow.sort_order,
          coverAttachmentId: existingRow.cover_attachment_id ?? null,
          description: existingRow.description ?? null,
          settingsJson: parseJsonRecord(existingRow.settings_json),
          version: existingRow.version,
          createdAt: existingRow.created_at,
          updatedAt: now,
          deletedAt: now,
          lastEventId: existingRow.last_event_id,
          syncedAt: existingRow.synced_at ?? null,
          dirtyState: 'clean',
        };
      }

      if (existingRow.deleted_at) {
        throw new Error(`Knowledge base already deleted: ${normalizedKnowledgeBaseId}`);
      }

      const payload = {
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        coverAttachmentId: existingRow.cover_attachment_id ?? null,
        description: existingRow.description ?? null,
        settingsJson: parseJsonRecord(existingRow.settings_json),
      };

      database
        .prepare(
          `
            UPDATE local_knowledge_bases
            SET
              deleted_at = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, now, 'pending_push', normalizedKnowledgeBaseId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'knowledge_base', ?, 'delete', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedKnowledgeBaseId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      return mapKnowledgeBaseRow(nextRow);
    });

    return apply();
  }

  function restoreKnowledgeBase(input) {
    const database = open();
    const normalizedKnowledgeBaseId = normalizeId(input?.knowledgeBaseId, 'knowledgeBaseId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      if (!existingRow) {
        throw new Error(`Knowledge base not found: ${normalizedKnowledgeBaseId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Knowledge base is not deleted: ${normalizedKnowledgeBaseId}`);
      }

      const sendingDeleteOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND operation = 'delete'
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedKnowledgeBaseId);

      if (sendingDeleteOutbox) {
        throw new Error(
          `Knowledge base delete is currently syncing and cannot be restored: ${normalizedKnowledgeBaseId}`,
        );
      }

      const pendingDeleteOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND operation = 'delete'
              AND status IN ('pending', 'failed', 'conflicted')
          `,
        )
        .all(existingRow.workspace_id, normalizedKnowledgeBaseId);

      const payload = {
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        coverAttachmentId: existingRow.cover_attachment_id ?? null,
        description: existingRow.description ?? null,
        settingsJson: parseJsonRecord(existingRow.settings_json),
      };

      database
        .prepare(
          `
            UPDATE local_knowledge_bases
            SET
              deleted_at = NULL,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, 'pending_push', normalizedKnowledgeBaseId);

      if (pendingDeleteOutboxes.length > 0) {
        for (const outbox of pendingDeleteOutboxes) {
          database
            .prepare(
              `
                DELETE FROM sync_conflicts
                WHERE outbox_id = ?
              `,
            )
            .run(outbox.id);
          database
            .prepare(
              `
                DELETE FROM sync_outbox
                WHERE id = ?
              `,
            )
            .run(outbox.id);
        }

        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'knowledge_base', ?, 'update', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedKnowledgeBaseId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
            now,
            now,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'knowledge_base', ?, 'restore', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedKnowledgeBaseId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      return mapKnowledgeBaseRow(nextRow);
    });

    return apply();
  }

  function purgeKnowledgeBase(input) {
    const database = open();
    const normalizedKnowledgeBaseId = normalizeId(input?.knowledgeBaseId, 'knowledgeBaseId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKnowledgeBaseId);

      if (!existingRow) {
        throw new Error(`Knowledge base not found: ${normalizedKnowledgeBaseId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Knowledge base is not deleted and cannot be purged: ${normalizedKnowledgeBaseId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedKnowledgeBaseId);

      if (sendingOutbox) {
        throw new Error(`Knowledge base is currently syncing and cannot be purged: ${normalizedKnowledgeBaseId}`);
      }

      const descendantActiveOutbox = findKnowledgeBaseSubtreeActiveOutbox(
        database,
        existingRow.workspace_id,
        normalizedKnowledgeBaseId,
      );
      if (descendantActiveOutbox) {
        throw new Error(
          `Knowledge base subtree still has pending sync state and cannot be purged: ${normalizedKnowledgeBaseId}`,
        );
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'knowledge_base'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedKnowledgeBaseId);

      for (const outbox of supersededOutboxes) {
        if (outbox.operation !== 'purge') {
          throw new Error(
            `Knowledge base has unfinished ${outbox.operation} sync and cannot be purged yet: ${normalizedKnowledgeBaseId}`,
          );
        }
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        coverAttachmentId: existingRow.cover_attachment_id ?? null,
        description: existingRow.description ?? null,
        settingsJson: parseJsonRecord(existingRow.settings_json),
        deletedAt: existingRow.deleted_at,
      };

      purgeKnowledgeBaseSubtreeLocally(database, normalizedKnowledgeBaseId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'knowledge_base', ?, 'purge', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedKnowledgeBaseId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('knowledge_base', normalizedKnowledgeBaseId),
          now,
          now,
        );
    });

    return apply();
  }

  function getCard(cardId) {
    const database = open();
    const row = database
      .prepare(
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
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_cards
          WHERE id = ?
        `,
      )
      .get(normalizeId(cardId, 'cardId'));
    return row ? mapCardRow(row) : null;
  }

  function createCard(input) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(input?.workspaceId, 'workspaceId');
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const normalizedKbId = normalizeId(input?.kbId, 'kbId');
    const normalizedParentId = normalizeNullableId(input?.parentId, 'parentId');
    const normalizedName = normalizeString(input?.name, 'name');
    const normalizedSortOrder = normalizeNullableNonNegativeInteger(input?.sortOrder, 'sortOrder');
    const normalizedStatus = normalizeString(input?.status, 'status', 'active');
    const normalizedMetaJson = normalizeRecord(input?.metaJson, 'metaJson', {});
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT id
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (existingRow) {
        throw new Error(`Card already exists locally: ${normalizedCardId}`);
      }

      const knowledgeBaseRow = database
        .prepare(
          `
            SELECT id, workspace_id
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKbId);

      if (!knowledgeBaseRow) {
        throw new Error(`Knowledge base not found: ${normalizedKbId}`);
      }
      if (knowledgeBaseRow.workspace_id !== normalizedWorkspaceId) {
        throw new Error('card workspaceId does not match knowledge base workspace');
      }

      if (normalizedParentId) {
        const parentRow = database
          .prepare(
            `
              SELECT id, workspace_id, kb_id
              FROM local_cards
              WHERE id = ?
            `,
          )
          .get(normalizedParentId);

        if (!parentRow) {
          throw new Error(`Parent card not found: ${normalizedParentId}`);
        }
        if (parentRow.workspace_id !== normalizedWorkspaceId) {
          throw new Error('card workspaceId does not match parent card workspace');
        }
        if (parentRow.kb_id !== normalizedKbId) {
          throw new Error('parent card must belong to the same knowledge base');
        }
      }

      const nextSortOrder =
        normalizedSortOrder ??
        database
          .prepare(
            `
              SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
              FROM local_cards
              WHERE workspace_id = ?
                AND kb_id = ?
                AND (
                  (parent_id IS NULL AND ? IS NULL)
                  OR parent_id = ?
                )
                AND deleted_at IS NULL
            `,
          )
          .get(
            normalizedWorkspaceId,
            normalizedKbId,
            normalizedParentId,
            normalizedParentId,
          ).next_sort_order;

      const payload = {
        kbId: normalizedKbId,
        parentId: normalizedParentId,
        name: normalizedName,
        sortOrder: nextSortOrder,
        status: normalizedStatus,
        metaJson: normalizedMetaJson,
      };

      database
        .prepare(
          `
            INSERT INTO local_cards (
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 0, NULL, 'pending_push')
          `,
        )
        .run(
          normalizedCardId,
          normalizedWorkspaceId,
          normalizedKbId,
          normalizedParentId,
          normalizedName,
          nextSortOrder,
          normalizedStatus,
          stringifyJson(normalizedMetaJson),
          now,
          now,
        );

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'card', ?, 'create', 0, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          normalizedWorkspaceId,
          normalizedCardId,
          stringifyJson(payload),
          createOutboxIdempotencyKey('card', normalizedCardId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      return mapCardRow(nextRow);
    });

    return apply();
  }

  function updateCard(input) {
    const database = open();
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const normalizedName = input?.name === undefined ? undefined : normalizeString(input?.name, 'name');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              version
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (!existingRow) {
        throw new Error(`Card not found: ${normalizedCardId}`);
      }

      const nextName = normalizedName ?? existingRow.name;
      const nextPayload = {
        kbId: existingRow.kb_id,
        parentId: existingRow.parent_id ?? null,
        name: nextName,
        sortOrder: existingRow.sort_order,
        status: existingRow.status,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };
      const reusableOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND operation = 'update'
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedCardId);

      database
        .prepare(
          `
            UPDATE local_cards
            SET
              name = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(nextName, now, 'pending_push', normalizedCardId);

      if (reusableOutbox) {
        database
          .prepare(
            `
              UPDATE sync_outbox
              SET
                base_version = ?,
                payload_json = ?,
                idempotency_key = ?,
                status = 'pending',
                next_retry_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                acked_event_id = NULL,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('card', normalizedCardId),
            now,
            reusableOutbox.id,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            'card',
            normalizedCardId,
            'update',
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('card', normalizedCardId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      return mapCardRow(nextRow);
    });

    return apply();
  }

  function deleteCard(input) {
    const database = open();
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (!existingRow) {
        throw new Error(`Card not found: ${normalizedCardId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedCardId);

      if (sendingOutbox) {
        throw new Error(`Card is currently syncing and cannot be deleted: ${normalizedCardId}`);
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedCardId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      if (existingRow.version === 0) {
        const hasPendingCreateOutbox = supersededOutboxes.some((outbox) => outbox.operation === 'create');
        if (!hasPendingCreateOutbox) {
          throw new Error(`Card cannot be deleted before initial sync: ${normalizedCardId}`);
        }

        database
          .prepare(
            `
              DELETE FROM local_cards
              WHERE id = ?
            `,
          )
          .run(normalizedCardId);

        return {
          id: existingRow.id,
          workspaceId: existingRow.workspace_id,
          kbId: existingRow.kb_id,
          parentId: existingRow.parent_id ?? null,
          name: existingRow.name,
          sortOrder: existingRow.sort_order,
          status: existingRow.status,
          metaJson: parseJsonRecord(existingRow.meta_json),
          version: existingRow.version,
          createdAt: existingRow.created_at,
          updatedAt: now,
          deletedAt: now,
          lastEventId: existingRow.last_event_id,
          syncedAt: existingRow.synced_at ?? null,
          dirtyState: 'clean',
        };
      }

      if (existingRow.deleted_at) {
        throw new Error(`Card already deleted: ${normalizedCardId}`);
      }

      const payload = {
        kbId: existingRow.kb_id,
        parentId: existingRow.parent_id ?? null,
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        status: existingRow.status,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      database
        .prepare(
          `
            UPDATE local_cards
            SET
              deleted_at = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, now, 'pending_push', normalizedCardId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'card', ?, 'delete', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedCardId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('card', normalizedCardId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      return mapCardRow(nextRow);
    });

    return apply();
  }

  function restoreCard(input) {
    const database = open();
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (!existingRow) {
        throw new Error(`Card not found: ${normalizedCardId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Card is not deleted: ${normalizedCardId}`);
      }

      const sendingDeleteOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND operation = 'delete'
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedCardId);

      if (sendingDeleteOutbox) {
        throw new Error(`Card delete is currently syncing and cannot be restored: ${normalizedCardId}`);
      }

      const pendingDeleteOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND operation = 'delete'
              AND status IN ('pending', 'failed', 'conflicted')
          `,
        )
        .all(existingRow.workspace_id, normalizedCardId);

      const payload = {
        kbId: existingRow.kb_id,
        parentId: existingRow.parent_id ?? null,
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        status: existingRow.status,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      database
        .prepare(
          `
            UPDATE local_cards
            SET
              deleted_at = NULL,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, 'pending_push', normalizedCardId);

      if (pendingDeleteOutboxes.length > 0) {
        for (const outbox of pendingDeleteOutboxes) {
          database
            .prepare(
              `
                DELETE FROM sync_conflicts
                WHERE outbox_id = ?
              `,
            )
            .run(outbox.id);
          database
            .prepare(
              `
                DELETE FROM sync_outbox
                WHERE id = ?
              `,
            )
            .run(outbox.id);
        }

        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'card', ?, 'update', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedCardId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('card', normalizedCardId),
            now,
            now,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'card', ?, 'restore', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedCardId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('card', normalizedCardId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      return mapCardRow(nextRow);
    });

    return apply();
  }

  function purgeCard(input) {
    const database = open();
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
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
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (!existingRow) {
        throw new Error(`Card not found: ${normalizedCardId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Card is not deleted and cannot be purged: ${normalizedCardId}`);
      }

      const activeOutbox = findCardSubtreeActiveOutbox(
        database,
        existingRow.workspace_id,
        normalizedCardId,
      );
      if (activeOutbox) {
        throw new Error(
          `Card subtree still has pending sync state and cannot be purged: ${normalizedCardId}`,
        );
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'card'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted', 'sending')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedCardId);

      for (const outbox of supersededOutboxes) {
        if (outbox.operation !== 'purge') {
          throw new Error(
            `Card has unfinished ${outbox.operation} sync and cannot be purged yet: ${normalizedCardId}`,
          );
        }
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        kbId: existingRow.kb_id,
        parentId: existingRow.parent_id ?? null,
        name: existingRow.name,
        sortOrder: existingRow.sort_order,
        status: existingRow.status,
        metaJson: parseJsonRecord(existingRow.meta_json),
        deletedAt: existingRow.deleted_at,
      };

      purgeCardSubtreeLocally(database, existingRow.workspace_id, normalizedCardId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'card', ?, 'purge', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedCardId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('card', normalizedCardId),
          now,
          now,
        );
    });

    return apply();
  }

  function createDocument(input) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(input?.workspaceId, 'workspaceId');
    const normalizedCardId = normalizeId(input?.cardId, 'cardId');
    const normalizedType = normalizeString(input?.type, 'type');
    if (!Object.prototype.hasOwnProperty.call(DOCUMENT_PATH_SUFFIX_BY_TYPE, normalizedType)) {
      throw new Error('type is invalid');
    }
    const normalizedTitle = normalizeString(input?.title, 'title');
    const normalizedParentDocumentId = normalizeNullableId(
      input?.parentDocumentId,
      'parentDocumentId',
    );
    const normalizedSortOrder = normalizeNullableNonNegativeInteger(input?.sortOrder, 'sortOrder');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const cardRow = database
        .prepare(
          `
            SELECT id, workspace_id, deleted_at
            FROM local_cards
            WHERE id = ?
          `,
        )
        .get(normalizedCardId);

      if (!cardRow) {
        throw new Error(`Card not found: ${normalizedCardId}`);
      }
      if (cardRow.workspace_id !== normalizedWorkspaceId) {
        throw new Error('document workspaceId does not match card workspace');
      }
      if (cardRow.deleted_at) {
        throw new Error(`Card is deleted: ${normalizedCardId}`);
      }

      if (normalizedParentDocumentId) {
        const parentRow = database
          .prepare(
            `
              SELECT id, workspace_id, card_id, deleted_at
              FROM local_documents
              WHERE id = ?
            `,
          )
          .get(normalizedParentDocumentId);

        if (!parentRow) {
          throw new Error(`Parent document not found: ${normalizedParentDocumentId}`);
        }
        if (parentRow.workspace_id !== normalizedWorkspaceId) {
          throw new Error('document workspaceId does not match parent document workspace');
        }
        if (parentRow.card_id !== normalizedCardId) {
          throw new Error('parent document must belong to the same card');
        }
        if (parentRow.deleted_at) {
          throw new Error(`Parent document is deleted: ${normalizedParentDocumentId}`);
        }
      }

      const nextSortOrder =
        normalizedSortOrder ??
        database
          .prepare(
            `
              SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
              FROM local_documents
              WHERE workspace_id = ?
                AND card_id = ?
                AND (
                  (parent_document_id IS NULL AND ? IS NULL)
                  OR parent_document_id = ?
                )
                AND deleted_at IS NULL
            `,
          )
          .get(
            normalizedWorkspaceId,
            normalizedCardId,
            normalizedParentDocumentId,
            normalizedParentDocumentId,
          ).next_sort_order;

      const documentId = randomUUID();
      const fileName = buildDefaultBootstrapDocumentFileName(documentId, normalizedType);
      const payload = {
        cardId: normalizedCardId,
        type: normalizedType,
        title: normalizedTitle,
        fileName,
        parentDocumentId: normalizedParentDocumentId,
        sortOrder: nextSortOrder,
        schemaVersion: 1,
        contentJson: {},
        metaJson: {},
      };

      database
        .prepare(
          `
            INSERT INTO local_documents (
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 0, NULL, 'pending_push')
          `,
        )
        .run(
          documentId,
          normalizedWorkspaceId,
          normalizedCardId,
          normalizedType,
          normalizedTitle,
          fileName,
          normalizedParentDocumentId,
          nextSortOrder,
          1,
          stringifyJson({}),
          stringifyJson({}),
          now,
          now,
        );

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'document', ?, 'create', 0, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          normalizedWorkspaceId,
          documentId,
          stringifyJson(payload),
          createOutboxIdempotencyKey('document', documentId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(documentId);

      return mapDocumentRow(nextRow);
    });

    return apply();
  }

  function getDocument(documentId) {
    const database = open();
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            card_id,
            type,
            title,
            file_name,
            parent_document_id,
            sort_order,
            schema_version,
            content_json,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_documents
          WHERE id = ?
        `,
      )
      .get(normalizeId(documentId, 'documentId'));
    return row ? mapDocumentRow(row) : null;
  }

  function updateDocument(input) {
    const database = open();
    const normalizedDocumentId = normalizeId(input?.documentId, 'documentId');
    const normalizedTitle =
      input?.title === undefined ? undefined : normalizeString(input?.title, 'title');
    const normalizedParentDocumentId =
      input?.parentDocumentId === undefined
        ? undefined
        : normalizeNullableId(input?.parentDocumentId, 'parentDocumentId');
    const normalizedSortOrder =
      input?.sortOrder === undefined
        ? undefined
        : normalizeNonNegativeInteger(input?.sortOrder, 'sortOrder');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              deleted_at
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      if (!existingRow) {
        throw new Error(`Document not found: ${normalizedDocumentId}`);
      }
      if (existingRow.deleted_at) {
        throw new Error(`Document is deleted: ${normalizedDocumentId}`);
      }

      const nextParentDocumentId =
        normalizedParentDocumentId === undefined
          ? (existingRow.parent_document_id ?? null)
          : normalizedParentDocumentId;
      if (nextParentDocumentId === normalizedDocumentId) {
        throw new Error('parentDocumentId cannot equal documentId');
      }

      if (nextParentDocumentId) {
        const parentRow = database
          .prepare(
            `
              SELECT id, workspace_id, card_id, deleted_at
              FROM local_documents
              WHERE id = ?
            `,
          )
          .get(nextParentDocumentId);

        if (!parentRow) {
          throw new Error(`Parent document not found: ${nextParentDocumentId}`);
        }
        if (parentRow.workspace_id !== existingRow.workspace_id) {
          throw new Error('document workspaceId does not match parent document workspace');
        }
        if (parentRow.card_id !== existingRow.card_id) {
          throw new Error('parent document must belong to the same card');
        }
        if (parentRow.deleted_at) {
          throw new Error(`Parent document is deleted: ${nextParentDocumentId}`);
        }
      }

      const nextTitle = normalizedTitle ?? existingRow.title;
      const nextSortOrder =
        normalizedSortOrder === undefined ? existingRow.sort_order : normalizedSortOrder;
      const nextPayload = {
        cardId: existingRow.card_id,
        type: existingRow.type,
        title: nextTitle,
        fileName:
          normalizeOptionalTrimmedString(existingRow.file_name) ??
          buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
        parentDocumentId: nextParentDocumentId,
        sortOrder: nextSortOrder,
        schemaVersion: existingRow.schema_version,
        contentJson: parseJsonRecord(existingRow.content_json),
        metaJson: parseJsonRecord(existingRow.meta_json),
      };
      const reusableOutbox = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedDocumentId);

      database
        .prepare(
          `
            UPDATE local_documents
            SET
              title = ?,
              parent_document_id = ?,
              sort_order = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(
          nextTitle,
          nextParentDocumentId,
          nextSortOrder,
          now,
          'pending_push',
          normalizedDocumentId,
        );

      if (reusableOutbox) {
        database
          .prepare(
            `
              UPDATE sync_outbox
              SET
                operation = ?,
                base_version = ?,
                payload_json = ?,
                idempotency_key = ?,
                status = 'pending',
                next_retry_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                acked_event_id = NULL,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            reusableOutbox.operation === 'create' ? 'create' : 'update',
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            reusableOutbox.id,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'document', ?, 'update', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedDocumentId,
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      return mapDocumentRow(nextRow);
    });

    return apply();
  }

  function deleteDocument(input) {
    const database = open();
    const normalizedDocumentId = normalizeId(input?.documentId, 'documentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      if (!existingRow) {
        throw new Error(`Document not found: ${normalizedDocumentId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedDocumentId);

      if (sendingOutbox) {
        throw new Error(`Document is currently syncing and cannot be deleted: ${normalizedDocumentId}`);
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedDocumentId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      if (existingRow.version === 0) {
        const hasPendingCreateOutbox = supersededOutboxes.some((outbox) => outbox.operation === 'create');
        if (!hasPendingCreateOutbox) {
          throw new Error(`Document cannot be deleted before initial sync: ${normalizedDocumentId}`);
        }

        database
          .prepare(
            `
              DELETE FROM local_documents
              WHERE id = ?
            `,
          )
          .run(normalizedDocumentId);

        return {
          id: existingRow.id,
          workspaceId: existingRow.workspace_id,
          cardId: existingRow.card_id,
          type: existingRow.type,
          title: existingRow.title,
          fileName:
            normalizeOptionalTrimmedString(existingRow.file_name) ??
            buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
          parentDocumentId: existingRow.parent_document_id ?? null,
          sortOrder: existingRow.sort_order,
          schemaVersion: existingRow.schema_version,
          contentJson: parseJsonRecord(existingRow.content_json),
          metaJson: parseJsonRecord(existingRow.meta_json),
          version: existingRow.version,
          createdAt: existingRow.created_at,
          updatedAt: now,
          deletedAt: now,
          lastEventId: existingRow.last_event_id,
          syncedAt: existingRow.synced_at ?? null,
          dirtyState: 'clean',
        };
      }

      if (existingRow.deleted_at) {
        throw new Error(`Document already deleted: ${normalizedDocumentId}`);
      }

      const payload = {
        cardId: existingRow.card_id,
        type: existingRow.type,
        title: existingRow.title,
        fileName:
          normalizeOptionalTrimmedString(existingRow.file_name) ??
          buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
        parentDocumentId: existingRow.parent_document_id ?? null,
        sortOrder: existingRow.sort_order,
        schemaVersion: existingRow.schema_version,
        contentJson: parseJsonRecord(existingRow.content_json),
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      database
        .prepare(
          `
            UPDATE local_documents
            SET
              deleted_at = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, now, 'pending_push', normalizedDocumentId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'document', ?, 'delete', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedDocumentId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('document', normalizedDocumentId),
          now,
          now,
        );

      const nextRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      return mapDocumentRow(nextRow);
    });

    return apply();
  }

  function restoreDocument(input) {
    const database = open();
    const normalizedDocumentId = normalizeId(input?.documentId, 'documentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      if (!existingRow) {
        throw new Error(`Document not found: ${normalizedDocumentId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Document is not deleted: ${normalizedDocumentId}`);
      }

      const sendingDeleteOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND operation = 'delete'
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedDocumentId);

      if (sendingDeleteOutbox) {
        throw new Error(`Document delete is currently syncing and cannot be restored: ${normalizedDocumentId}`);
      }

      const pendingDeleteOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND operation = 'delete'
              AND status IN ('pending', 'failed', 'conflicted')
          `,
        )
        .all(existingRow.workspace_id, normalizedDocumentId);

      const payload = {
        cardId: existingRow.card_id,
        type: existingRow.type,
        title: existingRow.title,
        fileName:
          normalizeOptionalTrimmedString(existingRow.file_name) ??
          buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
        parentDocumentId: existingRow.parent_document_id ?? null,
        sortOrder: existingRow.sort_order,
        schemaVersion: existingRow.schema_version,
        contentJson: parseJsonRecord(existingRow.content_json),
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      database
        .prepare(
          `
            UPDATE local_documents
            SET
              deleted_at = NULL,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, 'pending_push', normalizedDocumentId);

      if (pendingDeleteOutboxes.length > 0) {
        for (const outbox of pendingDeleteOutboxes) {
          database
            .prepare(
              `
                DELETE FROM sync_conflicts
                WHERE outbox_id = ?
              `,
            )
            .run(outbox.id);
          database
            .prepare(
              `
                DELETE FROM sync_outbox
                WHERE id = ?
              `,
            )
            .run(outbox.id);
        }

        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'document', ?, 'update', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedDocumentId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            now,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'document', ?, 'restore', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedDocumentId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      return mapDocumentRow(nextRow);
    });

    return apply();
  }

  function listAttachmentsByCard(workspaceId, cardId) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(workspaceId, 'workspaceId');
    const normalizedCardId = normalizeId(cardId, 'cardId');
    return database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            knowledge_base_id,
            card_id,
            document_id,
            file_name,
            mime_type,
            size_bytes,
            storage_provider,
            storage_bucket,
            storage_key,
            sha256,
            meta_json,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_attachments
          WHERE workspace_id = ?
            AND card_id = ?
          ORDER BY created_at DESC, updated_at DESC
        `,
      )
      .all(normalizedWorkspaceId, normalizedCardId)
      .map(mapSyncedAttachmentRow);
  }

  function deleteAttachment(input) {
    const database = open();
    const normalizedAttachmentId = normalizeId(input?.attachmentId, 'attachmentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              knowledge_base_id,
              card_id,
              document_id,
              file_name,
              mime_type,
              size_bytes,
              storage_provider,
              storage_bucket,
              storage_key,
              sha256,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_attachments
            WHERE id = ?
          `,
        )
        .get(normalizedAttachmentId);

      if (!existingRow) {
        throw new Error(`Attachment not found: ${normalizedAttachmentId}`);
      }
      if (existingRow.deleted_at) {
        throw new Error(`Attachment already deleted: ${normalizedAttachmentId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedAttachmentId);

      if (sendingOutbox) {
        throw new Error(`Attachment is currently syncing and cannot be deleted: ${normalizedAttachmentId}`);
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedAttachmentId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        knowledgeBaseId: existingRow.knowledge_base_id ?? null,
        cardId: existingRow.card_id ?? null,
        documentId: existingRow.document_id ?? null,
        fileName: existingRow.file_name,
        mimeType: existingRow.mime_type,
        sizeBytes: existingRow.size_bytes,
        storageProvider: existingRow.storage_provider,
        storageBucket: existingRow.storage_bucket,
        storageKey: existingRow.storage_key,
        sha256: existingRow.sha256 ?? null,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      database
        .prepare(
          `
            UPDATE local_attachments
            SET
              deleted_at = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, now, 'pending_push', normalizedAttachmentId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'attachment', ?, 'delete', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedAttachmentId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('attachment', normalizedAttachmentId),
          now,
          now,
        );

      return mapSyncedAttachmentRow(
        database
          .prepare(
            `
              SELECT
                id,
                workspace_id,
                knowledge_base_id,
                card_id,
                document_id,
                file_name,
                mime_type,
                size_bytes,
                storage_provider,
                storage_bucket,
                storage_key,
                sha256,
                meta_json,
                version,
                created_at,
                updated_at,
                deleted_at,
                last_event_id,
                synced_at,
                dirty_state
              FROM local_attachments
              WHERE id = ?
            `,
          )
          .get(normalizedAttachmentId),
      );
    });

    return apply();
  }

  function purgeDocument(input) {
    const database = open();
    const normalizedDocumentId = normalizeId(input?.documentId, 'documentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      if (!existingRow) {
        throw new Error(`Document not found: ${normalizedDocumentId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Document is not deleted and cannot be purged: ${normalizedDocumentId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedDocumentId);

      if (sendingOutbox) {
        throw new Error(`Document is currently syncing and cannot be purged: ${normalizedDocumentId}`);
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedDocumentId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        cardId: existingRow.card_id,
        type: existingRow.type,
        title: existingRow.title,
        fileName:
          normalizeOptionalTrimmedString(existingRow.file_name) ??
          buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
        parentDocumentId: existingRow.parent_document_id ?? null,
        sortOrder: existingRow.sort_order,
        schemaVersion: existingRow.schema_version,
        contentJson: parseJsonRecord(existingRow.content_json),
        metaJson: parseJsonRecord(existingRow.meta_json),
        deletedAt: existingRow.deleted_at,
      };

      database
        .prepare(
          `
            DELETE FROM local_documents
            WHERE id = ?
          `,
        )
        .run(normalizedDocumentId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'document', ?, 'purge', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedDocumentId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('document', normalizedDocumentId),
          now,
          now,
        );
    });

    return apply();
  }

  function restoreAttachment(input) {
    const database = open();
    const normalizedAttachmentId = normalizeId(input?.attachmentId, 'attachmentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              knowledge_base_id,
              card_id,
              document_id,
              file_name,
              mime_type,
              size_bytes,
              storage_provider,
              storage_bucket,
              storage_key,
              sha256,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_attachments
            WHERE id = ?
          `,
        )
        .get(normalizedAttachmentId);

      if (!existingRow) {
        throw new Error(`Attachment not found: ${normalizedAttachmentId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Attachment is not deleted: ${normalizedAttachmentId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedAttachmentId);

      if (sendingOutbox) {
        throw new Error(`Attachment is currently syncing and cannot be restored: ${normalizedAttachmentId}`);
      }

      const pendingDeleteOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND operation = 'delete'
              AND status IN ('pending', 'failed', 'conflicted')
          `,
        )
        .all(existingRow.workspace_id, normalizedAttachmentId);

      for (const outbox of pendingDeleteOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        knowledgeBaseId: existingRow.knowledge_base_id ?? null,
        cardId: existingRow.card_id ?? null,
        documentId: existingRow.document_id ?? null,
        fileName: existingRow.file_name,
        mimeType: existingRow.mime_type,
        sizeBytes: existingRow.size_bytes,
        storageProvider: existingRow.storage_provider,
        storageBucket: existingRow.storage_bucket,
        storageKey: existingRow.storage_key,
        sha256: existingRow.sha256 ?? null,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };

      const needsRestoreOutbox = pendingDeleteOutboxes.length === 0;

      database
        .prepare(
          `
            UPDATE local_attachments
            SET
              deleted_at = NULL,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(now, needsRestoreOutbox ? 'pending_push' : 'clean', normalizedAttachmentId);

      if (needsRestoreOutbox) {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'attachment', ?, 'restore', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            normalizedAttachmentId,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('attachment', normalizedAttachmentId),
            now,
            now,
          );
      }

      return mapSyncedAttachmentRow(
        database
          .prepare(
            `
              SELECT
                id,
                workspace_id,
                knowledge_base_id,
                card_id,
                document_id,
                file_name,
                mime_type,
                size_bytes,
                storage_provider,
                storage_bucket,
                storage_key,
                sha256,
                meta_json,
                version,
                created_at,
                updated_at,
                deleted_at,
                last_event_id,
                synced_at,
                dirty_state
              FROM local_attachments
              WHERE id = ?
            `,
          )
          .get(normalizedAttachmentId),
      );
    });

    return apply();
  }

  function purgeAttachment(input) {
    const database = open();
    const normalizedAttachmentId = normalizeId(input?.attachmentId, 'attachmentId');
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              knowledge_base_id,
              card_id,
              document_id,
              file_name,
              mime_type,
              size_bytes,
              storage_provider,
              storage_bucket,
              storage_key,
              sha256,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_attachments
            WHERE id = ?
          `,
        )
        .get(normalizedAttachmentId);

      if (!existingRow) {
        throw new Error(`Attachment not found: ${normalizedAttachmentId}`);
      }
      if (!existingRow.deleted_at) {
        throw new Error(`Attachment is not deleted and cannot be purged: ${normalizedAttachmentId}`);
      }

      const sendingOutbox = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND status = 'sending'
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedAttachmentId);

      if (sendingOutbox) {
        throw new Error(`Attachment is currently syncing and cannot be purged: ${normalizedAttachmentId}`);
      }

      const supersededOutboxes = database
        .prepare(
          `
            SELECT id
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'attachment'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
          `,
        )
        .all(existingRow.workspace_id, normalizedAttachmentId);

      for (const outbox of supersededOutboxes) {
        database
          .prepare(
            `
              DELETE FROM sync_conflicts
              WHERE outbox_id = ?
            `,
          )
          .run(outbox.id);
        database
          .prepare(
            `
              DELETE FROM sync_outbox
              WHERE id = ?
            `,
          )
          .run(outbox.id);
      }

      const payload = {
        knowledgeBaseId: existingRow.knowledge_base_id ?? null,
        cardId: existingRow.card_id ?? null,
        documentId: existingRow.document_id ?? null,
        fileName: existingRow.file_name,
        mimeType: existingRow.mime_type,
        sizeBytes: existingRow.size_bytes,
        storageProvider: existingRow.storage_provider,
        storageBucket: existingRow.storage_bucket,
        storageKey: existingRow.storage_key,
        sha256: existingRow.sha256 ?? null,
        metaJson: parseJsonRecord(existingRow.meta_json),
        deletedAt: existingRow.deleted_at,
      };

      database
        .prepare(
          `
            DELETE FROM local_attachments
            WHERE id = ?
          `,
        )
        .run(normalizedAttachmentId);

      database
        .prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              operation,
              base_version,
              payload_json,
              idempotency_key,
              status,
              attempt_count,
              next_retry_at,
              last_error_code,
              last_error_message,
              acked_event_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'attachment', ?, 'purge', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          randomUUID(),
          existingRow.workspace_id,
          normalizedAttachmentId,
          existingRow.version,
          stringifyJson(payload),
          createOutboxIdempotencyKey('attachment', normalizedAttachmentId),
          now,
          now,
        );
    });

    return apply();
  }

  function updateDocumentContent(input) {
    const database = open();
    const normalizedDocumentId = normalizeId(input?.documentId, 'documentId');
    const normalizedContentJson = normalizeRecord(input?.contentJson, 'contentJson', {});
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version
              ,
              meta_json,
              version
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      if (!existingRow) {
        throw new Error(`Document not found: ${normalizedDocumentId}`);
      }

      const nextSchemaVersion = normalizePositiveInteger(
        input?.schemaVersion,
        'schemaVersion',
        existingRow.schema_version,
      );
      const nextPayload = {
        cardId: existingRow.card_id,
        type: existingRow.type,
        title: existingRow.title,
        fileName:
          normalizeOptionalTrimmedString(existingRow.file_name) ??
          buildDefaultBootstrapDocumentFileName(normalizedDocumentId, existingRow.type),
        parentDocumentId: existingRow.parent_document_id ?? null,
        sortOrder: existingRow.sort_order,
        schemaVersion: nextSchemaVersion,
        contentJson: normalizedContentJson,
        metaJson: parseJsonRecord(existingRow.meta_json),
      };
      const reusableOutbox = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'document'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(existingRow.workspace_id, normalizedDocumentId);

      database
        .prepare(
          `
            UPDATE local_documents
            SET
              content_json = ?,
              schema_version = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(
          stringifyJson(normalizedContentJson),
          nextSchemaVersion,
          now,
          'pending_push',
          normalizedDocumentId,
        );

      if (reusableOutbox) {
        database
          .prepare(
            `
              UPDATE sync_outbox
              SET
                operation = ?,
                base_version = ?,
                payload_json = ?,
                idempotency_key = ?,
                status = 'pending',
                next_retry_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                acked_event_id = NULL,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            reusableOutbox.operation === 'create' ? 'create' : 'update',
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            reusableOutbox.id,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            existingRow.workspace_id,
            'document',
            normalizedDocumentId,
            'update',
            existingRow.version,
            stringifyJson(nextPayload),
            createOutboxIdempotencyKey('document', normalizedDocumentId),
            now,
            now,
          );
      }

      const nextRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              card_id,
              type,
              title,
              file_name,
              parent_document_id,
              sort_order,
              schema_version,
              content_json,
              meta_json,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_documents
            WHERE id = ?
          `,
        )
        .get(normalizedDocumentId);

      return mapDocumentRow(nextRow);
    });

    return apply();
  }

  function getGraphLayout(layoutId) {
    const database = open();
    const row = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            kb_id,
            room_card_id,
            layout_json,
            viewport_json,
            version,
            updated_by,
            created_at,
            updated_at,
            last_event_id,
            synced_at,
            dirty_state
          FROM local_graph_layouts
          WHERE id = ?
        `,
      )
      .get(normalizeId(layoutId, 'layoutId'));
    return row ? mapGraphLayoutRow(row) : null;
  }

  function updateGraphLayout(input) {
    const database = open();
    const normalizedWorkspaceId = normalizeId(input?.workspaceId, 'workspaceId');
    const normalizedKbId = normalizeId(input?.kbId, 'kbId');
    const normalizedRoomCardId = normalizeNullableId(input?.roomCardId, 'roomCardId');
    const normalizedLayoutJson = normalizeRecord(input?.layoutJson, 'layoutJson', {});
    const normalizedViewportJson = normalizeRecord(input?.viewportJson, 'viewportJson', {});
    const now = new Date().toISOString();

    const apply = database.transaction(() => {
      const knowledgeBaseRow = database
        .prepare(
          `
            SELECT id, workspace_id
            FROM local_knowledge_bases
            WHERE id = ?
          `,
        )
        .get(normalizedKbId);

      if (!knowledgeBaseRow) {
        throw new Error(`Knowledge base not found: ${normalizedKbId}`);
      }
      if (knowledgeBaseRow.workspace_id !== normalizedWorkspaceId) {
        throw new Error('graph layout workspaceId does not match knowledge base workspace');
      }

      if (normalizedRoomCardId) {
        const roomCardRow = database
          .prepare(
            `
              SELECT id, workspace_id, kb_id, deleted_at
              FROM local_cards
              WHERE id = ?
            `,
          )
          .get(normalizedRoomCardId);

        if (!roomCardRow) {
          throw new Error(`Room card not found: ${normalizedRoomCardId}`);
        }
        if (roomCardRow.workspace_id !== normalizedWorkspaceId) {
          throw new Error('graph layout workspaceId does not match room card workspace');
        }
        if (roomCardRow.kb_id !== normalizedKbId) {
          throw new Error('room card must belong to the same knowledge base');
        }
        if (roomCardRow.deleted_at) {
          throw new Error(`Room card is deleted: ${normalizedRoomCardId}`);
        }
      }

      const existingRow = database
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              kb_id,
              room_card_id,
              layout_json,
              viewport_json,
              version,
              updated_by,
              created_at,
              updated_at,
              last_event_id,
              synced_at,
              dirty_state
            FROM local_graph_layouts
            WHERE workspace_id = ?
              AND kb_id = ?
              AND (
                (room_card_id IS NULL AND ? IS NULL)
                OR room_card_id = ?
              )
            LIMIT 1
          `,
        )
        .get(
          normalizedWorkspaceId,
          normalizedKbId,
          normalizedRoomCardId,
          normalizedRoomCardId,
        );

      if (!existingRow) {
        const layoutId = randomUUID();
        const payload = {
          kbId: normalizedKbId,
          roomCardId: normalizedRoomCardId,
          layoutJson: normalizedLayoutJson,
          viewportJson: normalizedViewportJson,
        };

        database
          .prepare(
            `
              INSERT INTO local_graph_layouts (
                id,
                workspace_id,
                kb_id,
                room_card_id,
                layout_json,
                viewport_json,
                version,
                updated_by,
                created_at,
                updated_at,
                last_event_id,
                synced_at,
                dirty_state
              )
              VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0, NULL, 'pending_push')
            `,
          )
          .run(
            layoutId,
            normalizedWorkspaceId,
            normalizedKbId,
            normalizedRoomCardId,
            stringifyJson(normalizedLayoutJson),
            stringifyJson(normalizedViewportJson),
            now,
            now,
          );

        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'graph_layout', ?, 'create', 0, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            normalizedWorkspaceId,
            layoutId,
            stringifyJson(payload),
            createOutboxIdempotencyKey('graph_layout', layoutId),
            now,
            now,
          );

        return mapGraphLayoutRow(
          database
            .prepare(
              `
                SELECT
                  id,
                  workspace_id,
                  kb_id,
                  room_card_id,
                  layout_json,
                  viewport_json,
                  version,
                  updated_by,
                  created_at,
                  updated_at,
                  last_event_id,
                  synced_at,
                  dirty_state
                FROM local_graph_layouts
                WHERE id = ?
              `,
            )
            .get(layoutId),
        );
      }

      const payload = {
        kbId: normalizedKbId,
        roomCardId: normalizedRoomCardId,
        layoutJson: normalizedLayoutJson,
        viewportJson: normalizedViewportJson,
      };
      const reusableOutbox = database
        .prepare(
          `
            SELECT id, operation
            FROM sync_outbox
            WHERE workspace_id = ?
              AND entity_type = 'graph_layout'
              AND entity_id = ?
              AND status IN ('pending', 'failed', 'conflicted')
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(normalizedWorkspaceId, existingRow.id);

      database
        .prepare(
          `
            UPDATE local_graph_layouts
            SET
              kb_id = ?,
              room_card_id = ?,
              layout_json = ?,
              viewport_json = ?,
              updated_at = ?,
              dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(
          normalizedKbId,
          normalizedRoomCardId,
          stringifyJson(normalizedLayoutJson),
          stringifyJson(normalizedViewportJson),
          now,
          'pending_push',
          existingRow.id,
        );

      if (reusableOutbox) {
        database
          .prepare(
            `
              UPDATE sync_outbox
              SET
                operation = ?,
                base_version = ?,
                payload_json = ?,
                idempotency_key = ?,
                status = 'pending',
                next_retry_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                acked_event_id = NULL,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            reusableOutbox.operation === 'create' ? 'create' : 'update',
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('graph_layout', existingRow.id),
            now,
            reusableOutbox.id,
          );
      } else {
        database
          .prepare(
            `
              INSERT INTO sync_outbox (
                id,
                workspace_id,
                entity_type,
                entity_id,
                operation,
                base_version,
                payload_json,
                idempotency_key,
                status,
                attempt_count,
                next_retry_at,
                last_error_code,
                last_error_message,
                acked_event_id,
                created_at,
                updated_at
              )
              VALUES (?, ?, 'graph_layout', ?, 'update', ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            normalizedWorkspaceId,
            existingRow.id,
            existingRow.version,
            stringifyJson(payload),
            createOutboxIdempotencyKey('graph_layout', existingRow.id),
            now,
            now,
          );
      }

      return mapGraphLayoutRow(
        database
          .prepare(
            `
              SELECT
                id,
                workspace_id,
                kb_id,
                room_card_id,
                layout_json,
                viewport_json,
                version,
                updated_by,
                created_at,
                updated_at,
                last_event_id,
                synced_at,
                dirty_state
              FROM local_graph_layouts
              WHERE id = ?
            `,
          )
          .get(existingRow.id),
      );
    });

    return apply();
  }

  return {
    getPaths,
    init,
    open,
    close,
    healthCheck,
    applyBootstrap,
    applySyncPull,
    applySyncPushResult,
    getWorkspaceSnapshot,
    listKnowledgeBases,
    createKnowledgeBase,
    getKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    restoreKnowledgeBase,
    purgeKnowledgeBase,
    createCard,
    getCard,
    updateCard,
    deleteCard,
    restoreCard,
    purgeCard,
    createDocument,
    getDocument,
    updateDocument,
    deleteDocument,
    restoreDocument,
    purgeDocument,
    deleteAttachment,
    restoreAttachment,
    purgeAttachment,
    listAttachmentsByCard,
    listPendingOutbox,
    markOutboxItemSending,
    markOutboxItemFailed,
    recordSyncPushConflict,
    listSyncConflicts,
    getSyncDebugSnapshot,
    listSyncDebugOutboxItems,
    listSyncDebugConflicts,
    listSyncDebugAttachmentJobs,
    listImportAttachmentUploadJobs,
    createAttachmentUploadJob,
    getAttachmentUploadJob,
    claimNextPendingAttachmentUploadJob,
    markAttachmentUploadJobUploaded,
    markAttachmentUploadJobCommitting,
    completeAttachmentUploadJob,
    failAttachmentUploadJob,
    listSyncDebugImportJobs,
    createImportJob,
    getImportJob,
    claimNextPendingImportJob,
    updateImportJobProgress,
    completeImportJob,
    failImportJob,
    requeueImportJob,
    getImportStructureOutboxState,
    retrySyncDebugAttachmentJob,
    resumeSyncDebugImportJob,
    retrySyncDebugOutboxItem,
    resolveSyncDebugConflictUseLocal,
    updateDocumentContent,
    getGraphLayout,
    updateGraphLayout,
  };
}

function listMigrationFiles(migrationsDir) {
  if (!nodeFs.existsSync(migrationsDir)) {
    return [];
  }

  return nodeFs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

function purgeKnowledgeBaseSubtreeLocally(database, knowledgeBaseId) {
  database
    .prepare(
      `
        DELETE FROM local_attachments
        WHERE knowledge_base_id = ?
           OR card_id IN (
             SELECT id
             FROM local_cards
             WHERE kb_id = ?
           )
           OR document_id IN (
             SELECT d.id
             FROM local_documents d
             INNER JOIN local_cards c
               ON c.id = d.card_id
             WHERE c.kb_id = ?
           )
      `,
    )
    .run(knowledgeBaseId, knowledgeBaseId, knowledgeBaseId);

  database
    .prepare(
      `
        DELETE FROM local_documents
        WHERE card_id IN (
          SELECT id
          FROM local_cards
          WHERE kb_id = ?
        )
      `,
    )
    .run(knowledgeBaseId);

  database
    .prepare(
      `
        DELETE FROM local_graph_layouts
        WHERE kb_id = ?
      `,
    )
    .run(knowledgeBaseId);

  database
    .prepare(
      `
        DELETE FROM local_cards
        WHERE kb_id = ?
      `,
    )
    .run(knowledgeBaseId);

  database
    .prepare(
      `
        DELETE FROM local_knowledge_bases
        WHERE id = ?
      `,
    )
    .run(knowledgeBaseId);
}

function makeSqlPlaceholders(count) {
  return new Array(count).fill('?').join(', ');
}

function listLocalCardSubtreeIds(database, workspaceId, cardId) {
  return database
    .prepare(
      `
        WITH RECURSIVE subtree(id) AS (
          SELECT id
          FROM local_cards
          WHERE workspace_id = ?
            AND id = ?
          UNION ALL
          SELECT c.id
          FROM local_cards c
          INNER JOIN subtree s
            ON c.parent_id = s.id
          WHERE c.workspace_id = ?
        )
        SELECT id
        FROM subtree
      `,
    )
    .all(workspaceId, cardId, workspaceId)
    .map((row) => row.id);
}

function purgeCardSubtreeLocally(database, workspaceId, cardId) {
  const subtreeIds = listLocalCardSubtreeIds(database, workspaceId, cardId);
  if (subtreeIds.length === 0) {
    return [];
  }

  const placeholders = makeSqlPlaceholders(subtreeIds.length);

  database
    .prepare(
      `
        DELETE FROM local_attachments
        WHERE card_id IN (${placeholders})
           OR document_id IN (
             SELECT id
             FROM local_documents
             WHERE card_id IN (${placeholders})
           )
      `,
    )
    .run(...subtreeIds, ...subtreeIds);

  database
    .prepare(
      `
        DELETE FROM local_documents
        WHERE card_id IN (${placeholders})
      `,
    )
    .run(...subtreeIds);

  database
    .prepare(
      `
        DELETE FROM local_graph_layouts
        WHERE room_card_id IN (${placeholders})
      `,
    )
    .run(...subtreeIds);

  database
    .prepare(
      `
        DELETE FROM local_cards
        WHERE id IN (${placeholders})
      `,
    )
    .run(...subtreeIds);

  return subtreeIds;
}

function findKnowledgeBaseSubtreeActiveOutbox(database, workspaceId, knowledgeBaseId) {
  const knowledgeBaseOutbox = database
    .prepare(
      `
        SELECT id
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = 'knowledge_base'
          AND entity_id = ?
          AND status IN ('pending', 'failed', 'conflicted')
        LIMIT 1
      `,
    )
    .get(workspaceId, knowledgeBaseId);
  if (knowledgeBaseOutbox) {
    return knowledgeBaseOutbox;
  }

  const cardOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_cards c
          ON c.id = o.entity_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'card'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND c.kb_id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, knowledgeBaseId);
  if (cardOutbox) {
    return cardOutbox;
  }

  const graphLayoutOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_graph_layouts l
          ON l.id = o.entity_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'graph_layout'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND l.kb_id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, knowledgeBaseId);
  if (graphLayoutOutbox) {
    return graphLayoutOutbox;
  }

  const documentOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_documents d
          ON d.id = o.entity_id
        INNER JOIN local_cards c
          ON c.id = d.card_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'document'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND c.kb_id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, knowledgeBaseId);
  if (documentOutbox) {
    return documentOutbox;
  }

  const attachmentOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_attachments a
          ON a.id = o.entity_id
        LEFT JOIN local_cards c
          ON c.id = a.card_id
        LEFT JOIN local_documents d
          ON d.id = a.document_id
        LEFT JOIN local_cards dc
          ON dc.id = d.card_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'attachment'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND (
            a.knowledge_base_id = ?
            OR c.kb_id = ?
            OR dc.kb_id = ?
          )
        LIMIT 1
      `,
    )
    .get(workspaceId, knowledgeBaseId, knowledgeBaseId, knowledgeBaseId);
  if (attachmentOutbox) {
    return attachmentOutbox;
  }

  return null;
}

function findCardSubtreeActiveOutbox(database, workspaceId, cardId) {
  const subtreeIds = listLocalCardSubtreeIds(database, workspaceId, cardId);
  if (subtreeIds.length === 0) {
    return null;
  }

  const placeholders = makeSqlPlaceholders(subtreeIds.length);

  const cardOutbox = database
    .prepare(
      `
        SELECT id
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = 'card'
          AND status IN ('pending', 'failed', 'conflicted', 'sending')
          AND entity_id IN (${placeholders})
        LIMIT 1
      `,
    )
    .get(workspaceId, ...subtreeIds);
  if (cardOutbox) {
    return cardOutbox;
  }

  const graphLayoutOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_graph_layouts l
          ON l.id = o.entity_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'graph_layout'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND l.room_card_id IN (${placeholders})
        LIMIT 1
      `,
    )
    .get(workspaceId, ...subtreeIds);
  if (graphLayoutOutbox) {
    return graphLayoutOutbox;
  }

  const documentOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_documents d
          ON d.id = o.entity_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'document'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND d.card_id IN (${placeholders})
        LIMIT 1
      `,
    )
    .get(workspaceId, ...subtreeIds);
  if (documentOutbox) {
    return documentOutbox;
  }

  const attachmentOutbox = database
    .prepare(
      `
        SELECT o.id
        FROM sync_outbox o
        INNER JOIN local_attachments a
          ON a.id = o.entity_id
        LEFT JOIN local_documents d
          ON d.id = a.document_id
        WHERE o.workspace_id = ?
          AND o.entity_type = 'attachment'
          AND o.status IN ('pending', 'failed', 'conflicted', 'sending')
          AND (
            a.card_id IN (${placeholders})
            OR d.card_id IN (${placeholders})
          )
        LIMIT 1
      `,
    )
    .get(workspaceId, ...subtreeIds, ...subtreeIds);
  if (attachmentOutbox) {
    return attachmentOutbox;
  }

  return null;
}

function applyMigrations(database, migrationsDir) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all()
      .map((row) => row.version),
  );

  for (const fileName of listMigrationFiles(migrationsDir)) {
    if (appliedVersions.has(fileName)) {
      continue;
    }

    const sql = nodeFs.readFileSync(nodePath.join(migrationsDir, fileName), 'utf8');
    const apply = database.transaction(() => {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)')
        .run(fileName);
    });
    apply();
  }
}

function listCardsByWorkspace(database, workspaceId) {
  return database
    .prepare(
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
          deleted_at,
          last_event_id,
          synced_at,
          dirty_state
        FROM local_cards
        WHERE workspace_id = ?
        ORDER BY kb_id ASC, parent_id ASC, sort_order ASC, updated_at DESC, created_at DESC
      `,
    )
    .all(workspaceId)
    .map(mapCardRow);
}

function listDocumentsByWorkspace(database, workspaceId) {
  return database
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          card_id,
          type,
          title,
          file_name,
          parent_document_id,
          sort_order,
          schema_version,
          content_json,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_event_id,
          synced_at,
          dirty_state
        FROM local_documents
        WHERE workspace_id = ?
        ORDER BY card_id ASC, parent_document_id ASC, sort_order ASC, updated_at DESC, created_at DESC
      `,
    )
    .all(workspaceId)
    .map(mapDocumentRow);
}

function listGraphLayoutsByWorkspace(database, workspaceId) {
  return database
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          kb_id,
          room_card_id,
          layout_json,
          viewport_json,
          version,
          updated_by,
          created_at,
          updated_at,
          last_event_id,
          synced_at,
          dirty_state
        FROM local_graph_layouts
        WHERE workspace_id = ?
        ORDER BY kb_id ASC, room_card_id ASC, updated_at DESC, created_at DESC
      `,
    )
    .all(workspaceId)
    .map(mapGraphLayoutRow);
}

function listAttachmentsByWorkspace(database, workspaceId) {
  return database
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          knowledge_base_id,
          card_id,
          document_id,
          file_name,
          mime_type,
          size_bytes,
          storage_provider,
          storage_bucket,
          storage_key,
          sha256,
          meta_json,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_event_id,
          synced_at,
          dirty_state
        FROM local_attachments
        WHERE workspace_id = ?
        ORDER BY knowledge_base_id ASC, card_id ASC, document_id ASC, created_at DESC, updated_at DESC
      `,
    )
    .all(workspaceId)
    .map(mapSyncedAttachmentRow);
}

function normalizeId(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeBootstrapSnapshot(value) {
  if (!isPlainObject(value)) {
    throw new Error('bootstrap snapshot must be an object');
  }

  return {
    workspace: normalizeBootstrapWorkspace(value.workspace),
    cursor: normalizeBootstrapCursor(value.cursor),
    config: normalizeBootstrapConfig(value.config),
    knowledgeBases: normalizeBootstrapKnowledgeBases(value.knowledgeBases),
    cards: normalizeBootstrapCards(value.cards),
    documents: normalizeBootstrapDocuments(value.documents),
    graphLayouts: normalizeBootstrapGraphLayouts(value.graphLayouts),
    attachments: normalizeBootstrapAttachments(value.attachments),
  };
}

function normalizeBootstrapWorkspace(value) {
  if (!isPlainObject(value)) {
    throw new Error('bootstrap.workspace is required');
  }

  return {
    id: normalizeId(value.id, 'bootstrap.workspace.id'),
    name: normalizeString(value.name, 'bootstrap.workspace.name'),
    role: normalizeString(value.role, 'bootstrap.workspace.role'),
    updatedAt: normalizeNullableString(value.updatedAt, 'bootstrap.workspace.updatedAt') ?? new Date().toISOString(),
  };
}

function normalizeBootstrapCursor(value) {
  if (!isPlainObject(value)) {
    throw new Error('bootstrap.cursor is required');
  }

  return {
    lastEventId: normalizeNonNegativeInteger(value.lastEventId, 'bootstrap.cursor.lastEventId'),
  };
}

function normalizeBootstrapConfig(value) {
  if (!isPlainObject(value)) {
    return {
      version: 1,
      configJson: {},
      updatedAt: null,
    };
  }

  return {
    version: normalizePositiveInteger(value.version, 'bootstrap.config.version', 1),
    configJson: normalizeRecord(value.configJson, 'bootstrap.config.configJson', {}),
    updatedAt: normalizeNullableString(value.updatedAt, 'bootstrap.config.updatedAt'),
  };
}

function normalizeBootstrapKnowledgeBases(value) {
  return normalizeArray(value, 'bootstrap.knowledgeBases').map((row, index) => ({
    id: normalizeId(row.id, `bootstrap.knowledgeBases[${index}].id`),
    workspaceId: normalizeId(row.workspaceId, `bootstrap.knowledgeBases[${index}].workspaceId`),
    name: normalizeString(row.name, `bootstrap.knowledgeBases[${index}].name`),
    sortOrder: normalizeNonNegativeInteger(row.sortOrder, `bootstrap.knowledgeBases[${index}].sortOrder`, 0),
    coverAttachmentId: normalizeNullableId(
      row.coverAttachmentId,
      `bootstrap.knowledgeBases[${index}].coverAttachmentId`,
    ),
    description: normalizeNullableString(
      row.description,
      `bootstrap.knowledgeBases[${index}].description`,
    ),
    settingsJson: normalizeRecord(
      row.settingsJson,
      `bootstrap.knowledgeBases[${index}].settingsJson`,
      {},
    ),
    version: normalizePositiveInteger(row.version, `bootstrap.knowledgeBases[${index}].version`, 1),
    createdAt: normalizeNullableString(
      row.createdAt,
      `bootstrap.knowledgeBases[${index}].createdAt`,
    ) ?? new Date().toISOString(),
    updatedAt: normalizeNullableString(
      row.updatedAt,
      `bootstrap.knowledgeBases[${index}].updatedAt`,
    ) ?? new Date().toISOString(),
    deletedAt: normalizeNullableString(
      row.deletedAt,
      `bootstrap.knowledgeBases[${index}].deletedAt`,
    ),
  }));
}

function normalizeBootstrapCards(value) {
  return normalizeArray(value, 'bootstrap.cards').map((row, index) => ({
    id: normalizeId(row.id, `bootstrap.cards[${index}].id`),
    workspaceId: normalizeId(row.workspaceId, `bootstrap.cards[${index}].workspaceId`),
    kbId: normalizeId(row.kbId, `bootstrap.cards[${index}].kbId`),
    parentId: normalizeNullableId(row.parentId, `bootstrap.cards[${index}].parentId`),
    name: normalizeString(row.name, `bootstrap.cards[${index}].name`),
    sortOrder: normalizeNonNegativeInteger(row.sortOrder, `bootstrap.cards[${index}].sortOrder`, 0),
    status: normalizeString(row.status, `bootstrap.cards[${index}].status`, 'active'),
    metaJson: normalizeRecord(row.metaJson, `bootstrap.cards[${index}].metaJson`, {}),
    version: normalizePositiveInteger(row.version, `bootstrap.cards[${index}].version`, 1),
    createdAt: normalizeNullableString(row.createdAt, `bootstrap.cards[${index}].createdAt`) ?? new Date().toISOString(),
    updatedAt: normalizeNullableString(row.updatedAt, `bootstrap.cards[${index}].updatedAt`) ?? new Date().toISOString(),
    deletedAt: normalizeNullableString(row.deletedAt, `bootstrap.cards[${index}].deletedAt`),
  }));
}

function normalizeBootstrapDocuments(value) {
  return normalizeArray(value, 'bootstrap.documents').map((row, index) => {
    const label = `bootstrap.documents[${index}]`;
    const id = normalizeId(row.id, `${label}.id`);
    const type = normalizeString(row.type, `${label}.type`, 'smart');
    const metaJson = normalizeRecord(row.metaJson, `${label}.metaJson`, {});
    const fileName =
      normalizeBootstrapDocumentFileName(row.fileName, type, `${label}.fileName`) ??
      buildDefaultBootstrapDocumentFileName(id, type);
    return {
      id,
      workspaceId: normalizeId(row.workspaceId, `${label}.workspaceId`),
      cardId: normalizeId(row.cardId, `${label}.cardId`),
      type,
      title: normalizeString(row.title, `${label}.title`),
      fileName,
      parentDocumentId: normalizeNullableId(
        row.parentDocumentId,
        `${label}.parentDocumentId`,
      ),
      sortOrder: normalizeNonNegativeInteger(row.sortOrder, `${label}.sortOrder`, 0),
      schemaVersion: normalizePositiveInteger(
        row.schemaVersion,
        `${label}.schemaVersion`,
        1,
      ),
      contentJson: normalizeRecord(row.contentJson, `${label}.contentJson`, {}),
      metaJson,
      version: normalizePositiveInteger(row.version, `${label}.version`, 1),
      createdAt: normalizeNullableString(
        row.createdAt,
        `${label}.createdAt`,
      ) ?? new Date().toISOString(),
      updatedAt: normalizeNullableString(
        row.updatedAt,
        `${label}.updatedAt`,
      ) ?? new Date().toISOString(),
      deletedAt: normalizeNullableString(
        row.deletedAt,
        `${label}.deletedAt`,
      ),
    };
  });
}

function normalizeBootstrapGraphLayouts(value) {
  return normalizeArray(value, 'bootstrap.graphLayouts').map((row, index) => ({
    id: normalizeId(row.id, `bootstrap.graphLayouts[${index}].id`),
    workspaceId: normalizeId(row.workspaceId, `bootstrap.graphLayouts[${index}].workspaceId`),
    kbId: normalizeId(row.kbId, `bootstrap.graphLayouts[${index}].kbId`),
    roomCardId: normalizeNullableId(row.roomCardId, `bootstrap.graphLayouts[${index}].roomCardId`),
    layoutJson: normalizeRecord(row.layoutJson, `bootstrap.graphLayouts[${index}].layoutJson`, {}),
    viewportJson: normalizeRecord(
      row.viewportJson,
      `bootstrap.graphLayouts[${index}].viewportJson`,
      {},
    ),
    version: normalizePositiveInteger(row.version, `bootstrap.graphLayouts[${index}].version`, 1),
    updatedBy: normalizeNullableString(row.updatedBy, `bootstrap.graphLayouts[${index}].updatedBy`),
    createdAt: normalizeNullableString(
      row.createdAt,
      `bootstrap.graphLayouts[${index}].createdAt`,
    ) ?? new Date().toISOString(),
    updatedAt: normalizeNullableString(
      row.updatedAt,
      `bootstrap.graphLayouts[${index}].updatedAt`,
    ) ?? new Date().toISOString(),
  }));
}

function normalizeBootstrapAttachments(value) {
  return normalizeArray(value, 'bootstrap.attachments').map((row, index) => {
    const label = `bootstrap.attachments[${index}]`;
    const knowledgeBaseId = normalizeNullableId(row.knowledgeBaseId, `${label}.knowledgeBaseId`);
    const cardId = normalizeNullableId(row.cardId, `${label}.cardId`);
    const documentId = normalizeNullableId(row.documentId, `${label}.documentId`);
    assertAttachmentOwnerScope(knowledgeBaseId, cardId, label);
    if (documentId && !cardId) {
      throw new Error(`${label}.documentId requires cardId`);
    }
    return {
      id: normalizeId(row.id, `${label}.id`),
      workspaceId: normalizeId(row.workspaceId, `${label}.workspaceId`),
      knowledgeBaseId,
      cardId,
      documentId,
      fileName: normalizeString(row.fileName, `${label}.fileName`),
      mimeType: normalizeString(row.mimeType, `${label}.mimeType`),
      sizeBytes: normalizeNonNegativeInteger(row.sizeBytes, `${label}.sizeBytes`, 0),
      storageProvider: normalizeString(
        row.storageProvider,
        `${label}.storageProvider`,
      ),
      storageBucket: normalizeString(
        row.storageBucket,
        `${label}.storageBucket`,
      ),
      storageKey: normalizeString(row.storageKey, `${label}.storageKey`),
      sha256: normalizeNullableString(row.sha256, `${label}.sha256`),
      metaJson: normalizeRecord(row.metaJson, `${label}.metaJson`, {}),
      version: normalizePositiveInteger(row.version, `${label}.version`, 1),
      createdAt: normalizeNullableString(
        row.createdAt,
        `${label}.createdAt`,
      ) ?? new Date().toISOString(),
      updatedAt: normalizeNullableString(
        row.updatedAt,
        `${label}.updatedAt`,
      ) ?? new Date().toISOString(),
      deletedAt: normalizeNullableString(
        row.deletedAt,
        `${label}.deletedAt`,
      ),
    };
  });
}

function normalizeSyncPullPayload(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync pull payload must be an object');
  }

  const workspaceId = normalizeId(value.workspaceId, 'syncPull.workspaceId');
  const fromEventId = normalizeNonNegativeInteger(value.fromEventId, 'syncPull.fromEventId');
  const toEventId = normalizeNonNegativeInteger(value.toEventId, 'syncPull.toEventId');
  const hasMore = normalizeBoolean(value.hasMore, 'syncPull.hasMore');
  const events = normalizeArray(value.events, 'syncPull.events').map((row, index) =>
    normalizeSyncPullEvent(row, workspaceId, index),
  );

  let previousEventId = fromEventId;
  for (const event of events) {
    if (event.id <= previousEventId) {
      throw new Error('sync pull events must be strictly ordered by id');
    }
    previousEventId = event.id;
  }
  if (events.length > 0 && toEventId < events[events.length - 1].id) {
    throw new Error('syncPull.toEventId must be greater than or equal to the latest event id');
  }
  if (toEventId < fromEventId) {
    throw new Error('syncPull.toEventId must be greater than or equal to fromEventId');
  }

  return {
    workspaceId,
    fromEventId,
    toEventId,
    hasMore,
    events,
  };
}

function normalizeSyncPushConflictInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync push conflict input must be an object');
  }

  const errorCode = normalizeOptionalTrimmedString(value.errorCode);
  return {
    workspaceId: normalizeId(value.workspaceId, 'syncConflict.workspaceId'),
    outboxId: normalizeId(value.outboxId, 'syncConflict.outboxId'),
    conflictType: normalizeString(
      value.conflictType,
      'syncConflict.conflictType',
      mapErrorCodeToConflictType(errorCode),
    ),
    errorCode,
    errorMessage: normalizeOptionalTrimmedString(value.errorMessage),
    serverVersion: normalizeNullablePositiveInteger(
      value.serverVersion,
      'syncConflict.serverVersion',
    ),
    serverEventId: normalizeNullableNonNegativeInteger(
      value.serverEventId,
      'syncConflict.serverEventId',
    ),
    serverEntityJson: normalizeRecord(
      value.serverEntityJson,
      'syncConflict.serverEntityJson',
      {},
    ),
  };
}

function normalizeSyncPushResultInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync push result input must be an object');
  }

  const workspaceId = normalizeId(value.workspaceId, 'syncPush.workspaceId');
  const outboxId = normalizeId(value.outboxId, 'syncPush.outboxId');
  if (!isPlainObject(value.result)) {
    throw new Error('syncPush.result must be an object');
  }

  const entityType = normalizeSyncEntityType(value.result.entityType, 'syncPush.result.entityType');
  const operation = normalizeSyncOperation(value.result.operation, 'syncPush.result.operation');
  if (!isPlainObject(value.result.event)) {
    throw new Error('syncPush.result.event must be an object');
  }

  const event = {
    id: normalizeNonNegativeInteger(value.result.event.id, 'syncPush.result.event.id'),
    entityVersion: normalizePositiveInteger(
      value.result.event.entityVersion,
      'syncPush.result.event.entityVersion',
    ),
  };
  const entity = normalizeSyncPullEventPayload(
    entityType,
    value.result.entity,
    workspaceId,
    'syncPush.result.entity',
  );

  if (entity.version !== event.entityVersion) {
    throw new Error('syncPush.result.entity.version must match syncPush.result.event.entityVersion');
  }

  return {
    workspaceId,
    outboxId,
    result: {
      entityType,
      operation,
      entity,
      event,
    },
  };
}

function normalizeSyncDebugOutboxListInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug outbox list input must be an object');
  }

  return {
    workspaceId: normalizeId(value.workspaceId, 'syncDebugOutbox.workspaceId'),
    limit: normalizePositiveInteger(value.limit, 'syncDebugOutbox.limit', 20),
    statuses: normalizeSyncOutboxStatuses(value.statuses),
  };
}

function normalizeSyncDebugConflictListInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug conflict list input must be an object');
  }

  return {
    workspaceId: normalizeId(value.workspaceId, 'syncDebugConflict.workspaceId'),
    limit: normalizePositiveInteger(value.limit, 'syncDebugConflict.limit', 20),
    statuses: normalizeSyncConflictStatuses(value.statuses),
  };
}

function normalizeSyncDebugAttachmentJobListInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug attachment job list input must be an object');
  }

  return {
    workspaceId: normalizeId(value.workspaceId, 'syncDebugAttachmentJob.workspaceId'),
    limit: normalizePositiveInteger(value.limit, 'syncDebugAttachmentJob.limit', 20),
    statuses: normalizeAttachmentUploadJobStatuses(value.statuses),
  };
}

function normalizeCreateAttachmentUploadJobInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('create attachment upload job input must be an object');
  }

  const knowledgeBaseId = normalizeNullableId(
    value.knowledgeBaseId,
    'createAttachmentUploadJob.knowledgeBaseId',
  );
  const cardId = normalizeNullableId(value.cardId, 'createAttachmentUploadJob.cardId');
  const documentId = normalizeNullableId(value.documentId, 'createAttachmentUploadJob.documentId');
  assertAttachmentOwnerScope(knowledgeBaseId, cardId, 'createAttachmentUploadJob owner scope');
  if (!cardId && documentId) {
    throw new Error('createAttachmentUploadJob.documentId requires cardId');
  }

  return {
    attachmentJobId:
      value.attachmentJobId === undefined || value.attachmentJobId === null || value.attachmentJobId === ''
        ? null
        : normalizeId(value.attachmentJobId, 'createAttachmentUploadJob.attachmentJobId'),
    workspaceId: normalizeId(value.workspaceId, 'createAttachmentUploadJob.workspaceId'),
    localFilePath: normalizeString(value.localFilePath, 'createAttachmentUploadJob.localFilePath'),
    knowledgeBaseId,
    cardId,
    documentId,
    fileName: normalizeString(value.fileName, 'createAttachmentUploadJob.fileName'),
    mimeType: normalizeString(value.mimeType, 'createAttachmentUploadJob.mimeType'),
    sizeBytes: normalizePositiveInteger(value.sizeBytes, 'createAttachmentUploadJob.sizeBytes'),
    uploadTicketJson: normalizeRecord(value.uploadTicketJson, 'createAttachmentUploadJob.uploadTicketJson', {}),
    storageKey: normalizeNullableString(value.storageKey, 'createAttachmentUploadJob.storageKey'),
    sha256: normalizeNullableString(value.sha256, 'createAttachmentUploadJob.sha256'),
  };
}

function normalizeSyncDebugImportJobListInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug import job list input must be an object');
  }

  return {
    workspaceId: normalizeId(value.workspaceId, 'syncDebugImportJob.workspaceId'),
    limit: normalizePositiveInteger(value.limit, 'syncDebugImportJob.limit', 20),
    statuses: normalizeImportJobStatuses(value.statuses),
  };
}

function normalizeCreateImportJobInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('create import job input must be an object');
  }

  return {
    importJobId:
      value.importJobId === undefined || value.importJobId === null || value.importJobId === ''
        ? null
        : normalizeId(value.importJobId, 'createImportJob.importJobId'),
    workspaceId: normalizeId(value.workspaceId, 'createImportJob.workspaceId'),
    sourcePath: normalizeString(value.sourcePath, 'createImportJob.sourcePath'),
    stage: normalizeImportJobStage(value.stage, 'createImportJob.stage', 'source-import'),
    summaryJson: normalizeRecord(value.summaryJson, 'createImportJob.summaryJson', {}),
    reportPath: normalizeNullableString(value.reportPath, 'createImportJob.reportPath'),
  };
}

function normalizeImportJobLifecycleInput(value, nextStatus) {
  if (!isPlainObject(value)) {
    throw new Error(`import job ${nextStatus} input must be an object`);
  }

  return {
    importJobId: normalizeId(value.importJobId, `importJob${nextStatus}.importJobId`),
    stage: normalizeImportJobStage(value.stage, `importJob${nextStatus}.stage`, 'source-import'),
    summaryJson: normalizeRecord(value.summaryJson, `importJob${nextStatus}.summaryJson`, {}),
    reportPath: normalizeNullableString(value.reportPath, `importJob${nextStatus}.reportPath`),
  };
}

function normalizeImportJobProgressInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('import job progress input must be an object');
  }

  return {
    importJobId: normalizeId(value.importJobId, 'importJobProgress.importJobId'),
    stage: normalizeImportJobStage(value.stage, 'importJobProgress.stage'),
    summaryJson:
      value.summaryJson === undefined
        ? undefined
        : normalizeRecord(value.summaryJson, 'importJobProgress.summaryJson', {}),
    reportPath:
      value.reportPath === undefined
        ? undefined
        : normalizeNullableString(value.reportPath, 'importJobProgress.reportPath'),
  };
}

function normalizeRequeueImportJobInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('requeue import job input must be an object');
  }

  return {
    importJobId: normalizeId(value.importJobId, 'requeueImportJob.importJobId'),
    stage: normalizeImportJobStage(value.stage, 'requeueImportJob.stage'),
    summaryJson:
      value.summaryJson === undefined
        ? undefined
        : normalizeRecord(value.summaryJson, 'requeueImportJob.summaryJson', {}),
    reportPath:
      value.reportPath === undefined
        ? undefined
        : normalizeNullableString(value.reportPath, 'requeueImportJob.reportPath'),
  };
}

function normalizeImportStructureOutboxStateInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('import structure outbox state input must be an object');
  }

  const entityRefs = normalizeArray(value.entityRefs, 'importStructureOutboxState.entityRefs').map(
    (item, index) => ({
      entityType: normalizeString(
        item.entityType,
        `importStructureOutboxState.entityRefs[${index}].entityType`,
      ),
      entityId: normalizeId(
        item.entityId,
        `importStructureOutboxState.entityRefs[${index}].entityId`,
      ),
    }),
  );
  if (entityRefs.length === 0) {
    throw new Error('importStructureOutboxState.entityRefs must not be empty');
  }

  return {
    workspaceId: normalizeId(value.workspaceId, 'importStructureOutboxState.workspaceId'),
    entityRefs,
  };
}

function normalizeAttachmentUploadJobLifecycleInput(value, nextStatus) {
  if (!isPlainObject(value)) {
    throw new Error(`attachment upload job ${nextStatus} input must be an object`);
  }

  return {
    attachmentJobId: normalizeId(
      value.attachmentJobId,
      `attachmentUploadJob${nextStatus}.attachmentJobId`,
    ),
    uploadTicketJson:
      value.uploadTicketJson === undefined
        ? undefined
        : normalizeRecord(
            value.uploadTicketJson,
            `attachmentUploadJob${nextStatus}.uploadTicketJson`,
            {},
          ),
    storageKey:
      value.storageKey === undefined
        ? undefined
        : normalizeNullableString(
            value.storageKey,
            `attachmentUploadJob${nextStatus}.storageKey`,
          ),
    sha256:
      value.sha256 === undefined
        ? undefined
        : normalizeNullableString(value.sha256, `attachmentUploadJob${nextStatus}.sha256`),
    lastErrorCode:
      value.lastErrorCode === undefined
        ? null
        : normalizeNullableString(
            value.lastErrorCode,
            `attachmentUploadJob${nextStatus}.lastErrorCode`,
          ),
    lastErrorMessage:
      value.lastErrorMessage === undefined
        ? null
        : normalizeNullableString(
            value.lastErrorMessage,
            `attachmentUploadJob${nextStatus}.lastErrorMessage`,
          ),
  };
}

function normalizeSyncDebugRetryOutboxInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug retry outbox input must be an object');
  }

  return {
    outboxId: normalizeId(value.outboxId, 'syncDebugRetryOutbox.outboxId'),
  };
}

function normalizeSyncDebugRetryAttachmentJobInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug retry attachment job input must be an object');
  }

  return {
    attachmentJobId: normalizeId(
      value.attachmentJobId,
      'syncDebugRetryAttachmentJob.attachmentJobId',
    ),
  };
}

function normalizeSyncDebugResumeImportJobInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug resume import job input must be an object');
  }

  return {
    importJobId: normalizeId(value.importJobId, 'syncDebugResumeImportJob.importJobId'),
  };
}

function normalizeSyncDebugResolveConflictUseLocalInput(value) {
  if (!isPlainObject(value)) {
    throw new Error('sync debug resolve conflict input must be an object');
  }

  return {
    conflictId: normalizeId(value.conflictId, 'syncDebugResolveConflict.conflictId'),
  };
}

function normalizeSyncPullEvent(value, workspaceId, index) {
  if (!isPlainObject(value)) {
    throw new Error(`syncPull.events[${index}] must be an object`);
  }

  const label = `syncPull.events[${index}]`;
  const entityType = normalizeSyncEntityType(value.entityType, `${label}.entityType`);
  const event = {
    id: normalizeNonNegativeInteger(value.id, `${label}.id`),
    entityType,
    entityId: normalizeId(value.entityId, `${label}.entityId`),
    eventType: normalizeSyncEventType(value.eventType, `${label}.eventType`),
    entityVersion: normalizePositiveInteger(value.entityVersion, `${label}.entityVersion`),
    payload: normalizeSyncPullEventPayload(entityType, value.payload, workspaceId, `${label}.payload`),
    createdAt: normalizeString(value.createdAt, `${label}.createdAt`),
  };

  if (event.payload.id !== event.entityId) {
    throw new Error(`${label}.payload.id must match entityId`);
  }
  if (event.payload.workspaceId !== workspaceId) {
    throw new Error(`${label}.payload.workspaceId must match syncPull.workspaceId`);
  }
  if (event.payload.version !== event.entityVersion) {
    throw new Error(`${label}.payload.version must match entityVersion`);
  }

  return event;
}

function normalizeSyncPullEventPayload(entityType, value, workspaceId, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }

  switch (entityType) {
    case 'knowledge_base': {
      const [payload] = normalizeBootstrapKnowledgeBases([value]);
      if (payload.workspaceId !== workspaceId) {
        throw new Error(`${label}.workspaceId must match syncPull.workspaceId`);
      }
      return payload;
    }
    case 'card': {
      const [payload] = normalizeBootstrapCards([value]);
      if (payload.workspaceId !== workspaceId) {
        throw new Error(`${label}.workspaceId must match syncPull.workspaceId`);
      }
      return payload;
    }
    case 'document': {
      const [payload] = normalizeBootstrapDocuments([value]);
      if (payload.workspaceId !== workspaceId) {
        throw new Error(`${label}.workspaceId must match syncPull.workspaceId`);
      }
      return payload;
    }
    case 'graph_layout': {
      const [payload] = normalizeBootstrapGraphLayouts([value]);
      if (payload.workspaceId !== workspaceId) {
        throw new Error(`${label}.workspaceId must match syncPull.workspaceId`);
      }
      return payload;
    }
    case 'attachment': {
      const [payload] = normalizeBootstrapAttachments([value]);
      if (payload.workspaceId !== workspaceId) {
        throw new Error(`${label}.workspaceId must match syncPull.workspaceId`);
      }
      return payload;
    }
    default:
      throw new Error(`Unsupported sync entity type: ${String(entityType)}`);
  }
}

function normalizeSyncEntityType(value, label) {
  if (
    value === 'knowledge_base' ||
    value === 'card' ||
    value === 'document' ||
    value === 'graph_layout' ||
    value === 'attachment'
  ) {
    return value;
  }
  throw new Error(`${label} is invalid`);
}

function normalizeSyncEventType(value, label) {
  if (
    value === 'created' ||
    value === 'updated' ||
    value === 'deleted' ||
    value === 'restored' ||
    value === 'purged'
  ) {
    return value;
  }
  throw new Error(`${label} is invalid`);
}

function normalizeSyncOperation(value, label) {
  if (
    value === 'create' ||
    value === 'update' ||
    value === 'delete' ||
    value === 'restore' ||
    value === 'purge'
  ) {
    return value;
  }
  throw new Error(`${label} is invalid`);
}

function normalizeSyncOutboxStatuses(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('sync debug outbox statuses must be an array');
  }
  return value.map((item, index) => {
    if (
      item === 'pending' ||
      item === 'sending' ||
      item === 'failed' ||
      item === 'conflicted' ||
      item === 'done'
    ) {
      return item;
    }
    throw new Error(`sync debug outbox statuses[${index}] is invalid`);
  });
}

function normalizeSyncConflictStatuses(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('sync debug conflict statuses must be an array');
  }
  return value.map((item, index) => {
    if (item === 'open' || item === 'resolved' || item === 'ignored') {
      return item;
    }
    throw new Error(`sync debug conflict statuses[${index}] is invalid`);
  });
}

function normalizeAttachmentUploadJobStatuses(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('sync debug attachment job statuses must be an array');
  }
  return value.map((item, index) => {
    if (
      item === 'pending' ||
      item === 'uploading' ||
      item === 'uploaded' ||
      item === 'committing' ||
      item === 'done' ||
      item === 'failed' ||
      item === 'cancelled'
    ) {
      return item;
    }
    throw new Error(`sync debug attachment job statuses[${index}] is invalid`);
  });
}

function normalizeImportJobStatuses(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('sync debug import job statuses must be an array');
  }
  return value.map((item, index) => {
    if (
      item === 'pending' ||
      item === 'running' ||
      item === 'done' ||
      item === 'failed' ||
      item === 'cancelled'
    ) {
      return item;
    }
    throw new Error(`sync debug import job statuses[${index}] is invalid`);
  });
}

function normalizeImportJobStage(value, label, fallback = 'source-import') {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = normalizeString(value, label);
  if (
    normalized === 'source-import' ||
    normalized === 'scan' ||
    normalized === 'import-structure' ||
    normalized === 'push' ||
    normalized === 'import-attachments' ||
    normalized === 'report'
  ) {
    return normalized;
  }

  throw new Error(`${label} is invalid`);
}

function mapWorkspaceRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    serverUpdatedAt: row.server_updated_at,
    lastBootstrapAt: row.last_bootstrap_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
    bootstrapVersion: row.bootstrap_version,
    archivedAt: row.archived_at ?? null,
  };
}

function mapCursorRow(row) {
  return {
    workspaceId: row?.workspace_id ?? null,
    lastEventId: row?.last_event_id ?? 0,
    bootstrapCompletedAt: row?.bootstrap_completed_at ?? null,
    lastPullAt: row?.last_pull_at ?? null,
    lastPushAt: row?.last_push_at ?? null,
    serverTimeAtLastPull: row?.server_time_at_last_pull ?? null,
  };
}

function mapWorkspaceConfigRow(row) {
  return {
    workspaceId: row?.workspace_id ?? null,
    version: row?.config_version ?? 1,
    configJson: parseJsonRecord(row?.config_json),
    updatedAt: row?.updated_at ?? null,
    lastEventId: row?.last_event_id ?? 0,
    syncedAt: row?.synced_at ?? null,
  };
}

function mapKnowledgeBaseRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    sortOrder: row.sort_order,
    coverAttachmentId: row.cover_attachment_id ?? null,
    description: row.description ?? null,
    settingsJson: parseJsonRecord(row.settings_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    lastEventId: row.last_event_id,
    syncedAt: row.synced_at ?? null,
    dirtyState: row.dirty_state,
  };
}

function knowledgeBaseRowMatchesOutboxPayload(knowledgeBaseRow, payload) {
  return (
    knowledgeBaseRow.name === normalizeString(payload?.name, 'payload.name') &&
    knowledgeBaseRow.sort_order ===
      normalizeNonNegativeInteger(payload?.sortOrder, 'payload.sortOrder', knowledgeBaseRow.sort_order) &&
    (knowledgeBaseRow.cover_attachment_id ?? null) ===
      normalizeNullableId(payload?.coverAttachmentId, 'payload.coverAttachmentId') &&
    (knowledgeBaseRow.description ?? null) ===
      normalizeNullableString(payload?.description, 'payload.description') &&
    stringifyJson(parseJsonRecord(knowledgeBaseRow.settings_json)) ===
      stringifyJson(
        normalizeRecord(payload?.settingsJson, 'payload.settingsJson', parseJsonRecord(knowledgeBaseRow.settings_json)),
      )
  );
}

function mapCardRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kbId: row.kb_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    sortOrder: row.sort_order,
    status: row.status,
    metaJson: parseJsonRecord(row.meta_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    lastEventId: row.last_event_id,
    syncedAt: row.synced_at ?? null,
    dirtyState: row.dirty_state,
  };
}

function cardRowMatchesOutboxPayload(cardRow, payload) {
  return (
    cardRow.kb_id === normalizeId(payload?.kbId, 'payload.kbId') &&
    (cardRow.parent_id ?? null) === normalizeNullableId(payload?.parentId, 'payload.parentId') &&
    cardRow.name === normalizeString(payload?.name, 'payload.name') &&
    cardRow.sort_order === normalizeNonNegativeInteger(payload?.sortOrder, 'payload.sortOrder') &&
    cardRow.status === normalizeString(payload?.status, 'payload.status') &&
    stringifyJson(parseJsonRecord(cardRow.meta_json)) ===
      stringifyJson(normalizeRecord(payload?.metaJson, 'payload.metaJson', {}))
  );
}

function mapDocumentRow(row) {
  const fileName = normalizeOptionalTrimmedString(row.file_name);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    type: row.type,
    title: row.title,
    fileName: fileName ?? buildDefaultBootstrapDocumentFileName(row.id, row.type),
    parentDocumentId: row.parent_document_id ?? null,
    sortOrder: row.sort_order,
    schemaVersion: row.schema_version,
    contentJson: parseJsonRecord(row.content_json),
    metaJson: parseJsonRecord(row.meta_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    lastEventId: row.last_event_id,
    syncedAt: row.synced_at ?? null,
    dirtyState: row.dirty_state,
  };
}

function mapOutboxRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    baseVersion: row.base_version,
    payloadJson: parseJsonRecord(row.payload_json),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    ackedEventId: row.acked_event_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncConflictRow(row) {
  return {
    id: row.id,
    outboxId: row.outbox_id,
    workspaceId: row.workspace_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    conflictType: row.conflict_type,
    clientBaseVersion: row.client_base_version ?? null,
    serverVersion: row.server_version ?? null,
    serverEventId: row.server_event_id ?? null,
    localPayloadJson: parseJsonRecord(row.local_payload_json),
    serverEntityJson: parseJsonRecord(row.server_entity_json),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    updatedAt: row.updated_at,
  };
}

function mapAttachmentUploadJobRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    localFilePath: row.local_file_path,
    knowledgeBaseId: row.knowledge_base_id ?? null,
    cardId: row.card_id ?? null,
    documentId: row.document_id ?? null,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadTicketJson: parseJsonRecord(row.upload_ticket_json),
    storageKey: row.storage_key ?? null,
    sha256: row.sha256 ?? null,
    status: row.status,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncedAttachmentRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    knowledgeBaseId: row.knowledge_base_id ?? null,
    cardId: row.card_id,
    documentId: row.document_id ?? null,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storageProvider: row.storage_provider,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    sha256: row.sha256 ?? null,
    metaJson: parseJsonRecord(row.meta_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    lastEventId: row.last_event_id,
    syncedAt: row.synced_at ?? null,
    dirtyState: row.dirty_state,
  };
}

function assertAttachmentOwnerScope(knowledgeBaseId, cardId, label) {
  if ((knowledgeBaseId ? 1 : 0) + (cardId ? 1 : 0) !== 1) {
    throw new Error(`${label} must include exactly one owner scope`);
  }
}

function mapImportJobRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourcePath: row.source_path,
    stage: row.stage,
    status: row.status,
    summaryJson: parseJsonRecord(row.summary_json),
    reportPath: row.report_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGraphLayoutRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kbId: row.kb_id,
    roomCardId: row.room_card_id ?? null,
    layoutJson: parseJsonRecord(row.layout_json),
    viewportJson: parseJsonRecord(row.viewport_json),
    version: row.version,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventId: row.last_event_id,
    syncedAt: row.synced_at ?? null,
    dirtyState: row.dirty_state,
  };
}

function graphLayoutRowMatchesOutboxPayload(graphLayoutRow, payload) {
  return (
    graphLayoutRow.kb_id === normalizeId(payload?.kbId, 'payload.kbId') &&
    (graphLayoutRow.room_card_id ?? null) ===
      normalizeNullableId(payload?.roomCardId, 'payload.roomCardId') &&
    stringifyJson(parseJsonRecord(graphLayoutRow.layout_json)) ===
      stringifyJson(normalizeRecord(payload?.layoutJson, 'payload.layoutJson', {})) &&
    stringifyJson(parseJsonRecord(graphLayoutRow.viewport_json)) ===
      stringifyJson(normalizeRecord(payload?.viewportJson, 'payload.viewportJson', {}))
  );
}

function attachmentRowMatchesOutboxPayload(attachmentRow, payload) {
  return (
    (attachmentRow.knowledge_base_id ?? null) ===
      normalizeNullableId(payload?.knowledgeBaseId, 'payload.knowledgeBaseId') &&
    (attachmentRow.card_id ?? null) === normalizeNullableId(payload?.cardId, 'payload.cardId') &&
    (attachmentRow.document_id ?? null) ===
      normalizeNullableId(payload?.documentId, 'payload.documentId') &&
    attachmentRow.file_name === normalizeString(payload?.fileName, 'payload.fileName') &&
    attachmentRow.mime_type === normalizeString(payload?.mimeType, 'payload.mimeType') &&
    attachmentRow.size_bytes === normalizeNonNegativeInteger(payload?.sizeBytes, 'payload.sizeBytes') &&
    attachmentRow.storage_provider ===
      normalizeString(payload?.storageProvider, 'payload.storageProvider') &&
    attachmentRow.storage_bucket === normalizeString(payload?.storageBucket, 'payload.storageBucket') &&
    attachmentRow.storage_key === normalizeString(payload?.storageKey, 'payload.storageKey') &&
    (attachmentRow.sha256 ?? null) === normalizeNullableString(payload?.sha256, 'payload.sha256') &&
    stringifyJson(parseJsonRecord(attachmentRow.meta_json)) ===
      stringifyJson(normalizeRecord(payload?.metaJson, 'payload.metaJson', {}))
  );
}

function parseJsonRecord(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    return item;
  });
}

function normalizeString(value, label, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} is required`);
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

function normalizeNullableString(value, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeString(value, label);
}

function normalizeNonNegativeInteger(value, label, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} is required`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function normalizePositiveInteger(value, label, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} is required`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeNullableNonNegativeInteger(value, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizeNonNegativeInteger(value, label);
}

function normalizeNullablePositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizePositiveInteger(value, label);
}

function normalizeBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function normalizeNullableId(value, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeId(value, label);
}

function normalizeRecord(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback ?? {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function normalizeOptionalTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBootstrapDocumentFileName(value, type, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const raw = normalizeString(value, label);
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('/')) {
    throw new Error(`${label} must be a file name within _docs`);
  }
  const lower = normalized.toLowerCase();
  if (type === 'smart') {
    if (lower.endsWith('.tdoc.json')) return normalized;
    throw new Error(`${label} must end with .tdoc.json for smart document`);
  }
  if (type === 'mindmap') {
    if (lower.endsWith('.tmind.json')) return normalized;
    throw new Error(`${label} must end with .tmind.json for mindmap document`);
  }
  if (type === 'flowchart') {
    if (lower.endsWith('.tflow.json')) return normalized;
    throw new Error(`${label} must end with .tflow.json for flowchart document`);
  }
  return normalized;
}

function buildDefaultBootstrapDocumentFileName(documentId, type) {
  return `${documentId}${DOCUMENT_PATH_SUFFIX_BY_TYPE[type] || '.tdoc.json'}`;
}

function createOutboxIdempotencyKey(entityType, entityId) {
  return `${entityType}:${entityId}:${randomUUID()}`;
}

function mapErrorCodeToConflictType(errorCode) {
  const normalized = normalizeOptionalTrimmedString(errorCode)?.toLowerCase();
  if (normalized === 'version_conflict') {
    return 'version_conflict';
  }
  if (normalized === 'entity_already_exists') {
    return 'entity_already_exists';
  }
  if (normalized === 'entity_deleted') {
    return 'entity_deleted';
  }
  if (normalized === 'entity_already_deleted') {
    return 'entity_already_deleted';
  }
  if (normalized === 'entity_not_deleted') {
    return 'entity_not_deleted';
  }
  if (normalized === 'constraint_violation') {
    return 'constraint_violation';
  }
  return 'server_conflict';
}

function updateEntityDirtyState(database, entityType, entityId, dirtyState) {
  switch (entityType) {
    case 'knowledge_base':
      database
        .prepare(
          `
            UPDATE local_knowledge_bases
            SET dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(dirtyState, entityId);
      return;
    case 'card':
      database
        .prepare(
          `
            UPDATE local_cards
            SET dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(dirtyState, entityId);
      return;
    case 'document':
      database
        .prepare(
          `
            UPDATE local_documents
            SET dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(dirtyState, entityId);
      return;
    case 'graph_layout':
      database
        .prepare(
          `
            UPDATE local_graph_layouts
            SET dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(dirtyState, entityId);
      return;
    case 'attachment':
      database
        .prepare(
          `
            UPDATE local_attachments
            SET dirty_state = ?
            WHERE id = ?
          `,
        )
        .run(dirtyState, entityId);
      return;
    default:
      throw new Error(`Unsupported sync entity type: ${String(entityType)}`);
  }
}

function documentRowMatchesOutboxPayload(documentRow, payload) {
  return (
    documentRow.card_id === normalizeId(payload?.cardId, 'payload.cardId') &&
    documentRow.type === normalizeString(payload?.type, 'payload.type') &&
    documentRow.title === normalizeString(payload?.title, 'payload.title') &&
    normalizeOptionalTrimmedString(documentRow.file_name) === normalizeOptionalTrimmedString(payload?.fileName) &&
    (documentRow.parent_document_id ?? null) === normalizeNullableId(payload?.parentDocumentId, 'payload.parentDocumentId') &&
    documentRow.sort_order === normalizeNonNegativeInteger(payload?.sortOrder, 'payload.sortOrder') &&
    documentRow.schema_version === normalizePositiveInteger(payload?.schemaVersion, 'payload.schemaVersion') &&
    stringifyJson(parseJsonRecord(documentRow.content_json)) ===
      stringifyJson(normalizeRecord(payload?.contentJson, 'payload.contentJson', {})) &&
    stringifyJson(parseJsonRecord(documentRow.meta_json)) ===
      stringifyJson(normalizeRecord(payload?.metaJson, 'payload.metaJson', {}))
  );
}

function stringifyJson(value) {
  return JSON.stringify(isPlainObject(value) ? value : {});
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

