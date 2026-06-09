export interface LocalDbHealth {
  ready: boolean
  paths: {
    rootDir: string
    dbPath: string
    runtimeMigrationsDir: string
    sourceMigrationsDir: string
  }
  migrationCount: number
  journalMode: string
  tables: string[]
}

export interface LocalDbPaths {
  rootDir: string
  dbPath: string
  runtimeMigrationsDir: string
  sourceMigrationsDir: string
}

export interface LocalDbCursor {
  workspaceId: string | null
  lastEventId: number
  bootstrapCompletedAt: string | null
  lastPullAt: string | null
  lastPushAt: string | null
  serverTimeAtLastPull: string | null
}

export interface LocalWorkspaceConfigRecord {
  workspaceId: string | null
  version: number
  configJson: Record<string, unknown>
  updatedAt: string | null
  lastEventId: number
  syncedAt: string | null
}

export interface LocalWorkspaceConfigUpdateInput {
  workspaceId: string
  configJson: Record<string, unknown>
}

export interface LocalWorkspaceSummary {
  id: string
  name: string
  role: string
  serverUpdatedAt: string
  lastBootstrapAt: string | null
  lastOpenedAt: string | null
  bootstrapVersion: number
  archivedAt: string | null
}

export interface LocalKnowledgeBaseRecord {
  id: string
  workspaceId: string
  name: string
  sortOrder: number
  coverAttachmentId: string | null
  description: string | null
  settingsJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  lastEventId: number
  syncedAt: string | null
  dirtyState: string
}

export interface LocalKnowledgeBaseUpdateInput {
  knowledgeBaseId: string
  name?: string
  coverAttachmentId?: string | null
}

export interface LocalKnowledgeBaseDeleteInput {
  knowledgeBaseId: string
}

export interface LocalCardRecord {
  id: string
  workspaceId: string
  kbId: string
  parentId: string | null
  name: string
  sortOrder: number
  status: string
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  lastEventId: number
  syncedAt: string | null
  dirtyState: string
}

export interface LocalCardCreateInput {
  workspaceId: string
  cardId: string
  kbId: string
  parentId?: string | null
  name: string
  sortOrder?: number
  status?: string
  metaJson?: Record<string, unknown>
}

export interface LocalCardUpdateInput {
  cardId: string
  name?: string
}

export interface LocalCardDeleteInput {
  cardId: string
}

export interface LocalDocumentRecord {
  id: string
  workspaceId: string
  cardId: string
  type: string
  title: string
  fileName: string
  parentDocumentId: string | null
  sortOrder: number
  schemaVersion: number
  contentJson: Record<string, unknown>
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  lastEventId: number
  syncedAt: string | null
  dirtyState: string
}

export interface LocalDocumentCreateInput {
  workspaceId: string
  cardId: string
  type: string
  title: string
  parentDocumentId?: string | null
  sortOrder?: number
}

export interface LocalDocumentUpdateInput {
  documentId: string
  title?: string
  parentDocumentId?: string | null
  sortOrder?: number
}

export interface LocalDocumentDeleteInput {
  documentId: string
}

export interface LocalAttachmentDeleteInput {
  attachmentId: string
}

export interface LocalDocumentContentUpdateInput {
  documentId: string
  contentJson: Record<string, unknown>
  schemaVersion?: number
}

export type CloudSyncEntityType =
  | 'knowledge_base'
  | 'card'
  | 'document'
  | 'graph_layout'
  | 'attachment'
  | 'workspace_config'

export type CloudSyncOperation = 'create' | 'update' | 'delete' | 'restore' | 'purge'

export interface LocalSyncOutboxItem {
  id: string
  workspaceId: string
  entityType: CloudSyncEntityType
  entityId: string
  operation: CloudSyncOperation
  baseVersion: number
  payloadJson: Record<string, unknown>
  idempotencyKey: string
  status: 'pending' | 'sending' | 'failed' | 'conflicted' | 'done'
  attemptCount: number
  nextRetryAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  ackedEventId: number | null
  createdAt: string
  updatedAt: string
}

export interface LocalOutboxFailureInput {
  outboxId: string
  errorCode?: string | null
  errorMessage?: string | null
  nextRetryAt?: string | null
}

export interface LocalSyncConflictRecord {
  id: string
  outboxId: string
  workspaceId: string
  entityType: CloudSyncEntityType
  entityId: string
  conflictType: string
  clientBaseVersion: number | null
  serverVersion: number | null
  serverEventId: number | null
  localPayloadJson: Record<string, unknown>
  serverEntityJson: Record<string, unknown>
  errorCode: string | null
  errorMessage: string | null
  status: 'open' | 'resolved' | 'ignored'
  createdAt: string
  resolvedAt: string | null
  updatedAt: string
}

export interface LocalAttachmentUploadJob {
  id: string
  workspaceId: string
  localFilePath: string
  knowledgeBaseId: string | null
  cardId: string | null
  documentId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadTicketJson: Record<string, unknown>
  storageKey: string | null
  sha256: string | null
  status: 'pending' | 'uploading' | 'uploaded' | 'committing' | 'done' | 'failed' | 'cancelled'
  attemptCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalImportJobRecord {
  id: string
  workspaceId: string
  sourcePath: string
  stage:
    | 'source-import'
    | 'scan'
    | 'import-structure'
    | 'push'
    | 'import-attachments'
    | 'report'
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  summaryJson: Record<string, unknown>
  reportPath: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalSyncPushConflictInput {
  workspaceId: string
  outboxId: string
  conflictType?: string
  errorCode?: string | null
  errorMessage?: string | null
  serverVersion?: number | null
  serverEventId?: number | null
  serverEntityJson?: Record<string, unknown>
}

export interface LocalGraphLayoutRecord {
  id: string
  workspaceId: string
  kbId: string
  roomCardId: string | null
  layoutJson: Record<string, unknown>
  viewportJson: Record<string, unknown>
  version: number
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  lastEventId: number
  syncedAt: string | null
  dirtyState: string
}

export interface LocalAttachmentRecord {
  id: string
  workspaceId: string
  knowledgeBaseId: string | null
  cardId: string | null
  documentId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: string
  storageBucket: string
  storageKey: string
  sha256: string | null
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  lastEventId: number
  syncedAt: string | null
  dirtyState: string
}

export interface LocalGraphLayoutUpdateInput {
  workspaceId: string
  kbId: string
  roomCardId?: string | null
  layoutJson: Record<string, unknown>
  viewportJson: Record<string, unknown>
}

export interface LocalWorkspaceSnapshot {
  workspace: LocalWorkspaceSummary | null
  cursor: LocalDbCursor
  config: LocalWorkspaceConfigRecord
  knowledgeBases: LocalKnowledgeBaseRecord[]
  cards: LocalCardRecord[]
  documents: LocalDocumentRecord[]
  graphLayouts: LocalGraphLayoutRecord[]
  attachments: LocalAttachmentRecord[]
}

export interface CloudBootstrapKnowledgeBase {
  id: string
  workspaceId: string
  name: string
  sortOrder: number
  coverAttachmentId: string | null
  description: string | null
  settingsJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CloudBootstrapCard {
  id: string
  workspaceId: string
  kbId: string
  parentId: string | null
  name: string
  sortOrder: number
  status: string
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CloudBootstrapDocument {
  id: string
  workspaceId: string
  cardId: string
  type: string
  title: string
  fileName: string
  parentDocumentId: string | null
  sortOrder: number
  schemaVersion: number
  contentJson: Record<string, unknown>
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CloudBootstrapGraphLayout {
  id: string
  workspaceId: string
  kbId: string
  roomCardId: string | null
  layoutJson: Record<string, unknown>
  viewportJson: Record<string, unknown>
  version: number
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CloudBootstrapAttachment {
  id: string
  workspaceId: string
  knowledgeBaseId: string | null
  cardId: string | null
  documentId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: string
  storageBucket: string
  storageKey: string
  sha256: string | null
  metaJson: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CloudWorkspaceBootstrap {
  workspace: {
    id: string
    name: string
    role: string
    updatedAt: string
  }
  cursor: {
    lastEventId: number
  }
  config: CloudBootstrapConfig
  knowledgeBases: CloudBootstrapKnowledgeBase[]
  cards: CloudBootstrapCard[]
  documents: CloudBootstrapDocument[]
  graphLayouts: CloudBootstrapGraphLayout[]
  attachments: CloudBootstrapAttachment[]
}

export interface CloudBootstrapConfig {
  workspaceId?: string | null
  version: number
  configJson: Record<string, unknown>
  updatedAt: string | null
}

export type CloudSyncEventType = 'created' | 'updated' | 'deleted' | 'restored' | 'purged'

export interface CloudSyncPullEvent {
  id: number
  entityType: CloudSyncEntityType
  entityId: string
  eventType: CloudSyncEventType
  entityVersion: number
  payload: Record<string, unknown>
  createdAt: string
}

export interface CloudSyncPullData {
  workspaceId: string
  fromEventId: number
  toEventId: number
  hasMore: boolean
  events: CloudSyncPullEvent[]
}

export interface CloudSyncPushRequest {
  entityType: CloudSyncEntityType
  operation: CloudSyncOperation
  entityId: string
  baseVersion: number
  idempotencyKey: string
  payload: Record<string, unknown>
  client?: {
    deviceId?: string
    requestId?: string
    sentAt?: string
  }
}

export interface CloudSyncPushSuccessData {
  entityType: CloudSyncEntityType
  operation: CloudSyncOperation
  entity: Record<string, unknown>
  event: {
    id: number
    entityVersion: number
  }
}

export interface LocalApplySyncPushResultInput {
  workspaceId: string
  outboxId: string
  result: CloudSyncPushSuccessData
}
