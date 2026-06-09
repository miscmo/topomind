import { CLOUD_LOCALDB_UPDATED_EVENT } from '../application/cloud/events'
import { CloudApiError, cloudApi } from './cloud-api'
import type {
  CloudBootstrapAttachment,
  CloudBootstrapCard,
  CloudBootstrapConfig,
  CloudBootstrapDocument,
  CloudBootstrapGraphLayout,
  CloudBootstrapKnowledgeBase,
  CloudSyncEntityType,
  CloudSyncPullData,
  CloudSyncPullEvent,
  CloudSyncPushRequest,
  CloudSyncPushSuccessData,
  CloudWorkspaceBootstrap,
  LocalApplySyncPushResultInput,
  LocalAttachmentDeleteInput,
  LocalAttachmentRecord,
  LocalCardCreateInput,
  LocalCardDeleteInput,
  LocalCardRecord,
  LocalCardUpdateInput,
  LocalDbHealth,
  LocalDbPaths,
  LocalDocumentContentUpdateInput,
  LocalDocumentCreateInput,
  LocalDocumentDeleteInput,
  LocalDocumentRecord,
  LocalDocumentUpdateInput,
  LocalGraphLayoutRecord,
  LocalGraphLayoutUpdateInput,
  LocalKnowledgeBaseDeleteInput,
  LocalKnowledgeBaseRecord,
  LocalKnowledgeBaseUpdateInput,
  LocalOutboxFailureInput,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
  LocalSyncPushConflictInput,
  LocalWorkspaceConfigUpdateInput,
  LocalWorkspaceSnapshot,
} from '../types/local-sync'

const BROWSER_LOCALDB_STORAGE_KEY = 'topomind_browser_localdb_snapshots_v1'

function emitLocalDbUpdated(workspaceId: string, lastEventId?: number) {
  window.dispatchEvent(
    new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
      detail: {
        workspaceId,
        ...(typeof lastEventId === 'number' ? { lastEventId } : {}),
      },
    }),
  )
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function createEmptySnapshot(workspaceId: string | null): LocalWorkspaceSnapshot {
  return {
    workspace: null,
    cursor: {
      workspaceId,
      lastEventId: 0,
      bootstrapCompletedAt: null,
      lastPullAt: null,
      lastPushAt: null,
      serverTimeAtLastPull: null,
    },
    config: {
      workspaceId,
      version: 1,
      configJson: {},
      updatedAt: null,
      lastEventId: 0,
      syncedAt: null,
    },
    knowledgeBases: [],
    cards: [],
    documents: [],
    graphLayouts: [],
    attachments: [],
  }
}

function readBrowserSnapshots(): Record<string, LocalWorkspaceSnapshot> {
  try {
    const raw = window.localStorage.getItem(BROWSER_LOCALDB_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, LocalWorkspaceSnapshot>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeBrowserSnapshots(state: Record<string, LocalWorkspaceSnapshot>) {
  try {
    window.localStorage.setItem(BROWSER_LOCALDB_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota / storage errors in browser preview mode.
  }
}

function getBrowserSnapshot(workspaceId: string): LocalWorkspaceSnapshot {
  const state = readBrowserSnapshots()
  const snapshot = state[workspaceId]
  return snapshot ? cloneValue(snapshot) : createEmptySnapshot(workspaceId)
}

function saveBrowserSnapshot(workspaceId: string, snapshot: LocalWorkspaceSnapshot) {
  const state = readBrowserSnapshots()
  state[workspaceId] = cloneValue(snapshot)
  writeBrowserSnapshots(state)
  return cloneValue(snapshot)
}

function mergeBrowserDirtyRecords<T extends { id: string; dirtyState: string }>(
  syncedRecords: T[],
  existingRecords: T[],
) {
  const preservedDirtyRecords = existingRecords.filter((item) => item.dirtyState === 'dirty')
  const dirtyIds = new Set(preservedDirtyRecords.map((item) => item.id))
  return [
    ...syncedRecords.filter((item) => !dirtyIds.has(item.id)),
    ...preservedDirtyRecords.map((item) => cloneValue(item)),
  ]
}

function applyBrowserBootstrap(snapshot: CloudWorkspaceBootstrap): LocalWorkspaceSnapshot {
  const now = new Date().toISOString()
  const lastEventId = snapshot.cursor.lastEventId
  const workspaceId = snapshot.workspace.id
  const existingSnapshot = getBrowserSnapshot(workspaceId)
  const remoteConfig: LocalWorkspaceSnapshot['config'] = {
    workspaceId,
    version: snapshot.config.version,
    configJson: cloneValue(snapshot.config.configJson),
    updatedAt: snapshot.config.updatedAt,
    lastEventId,
    syncedAt: now,
  }
  const nextSnapshot: LocalWorkspaceSnapshot = {
    workspace: {
      id: workspaceId,
      name: snapshot.workspace.name,
      role: snapshot.workspace.role,
      serverUpdatedAt: snapshot.workspace.updatedAt,
      lastBootstrapAt: now,
      lastOpenedAt: now,
      bootstrapVersion: 1,
      archivedAt: null,
    },
    cursor: {
      workspaceId,
      lastEventId,
      bootstrapCompletedAt: now,
      lastPullAt: now,
      lastPushAt: existingSnapshot.cursor.lastPushAt,
      serverTimeAtLastPull: now,
    },
    config: preserveLocalConfig(existingSnapshot.config, remoteConfig),
    knowledgeBases: snapshot.knowledgeBases.map((item) => toLocalKnowledgeBaseRecord(item, lastEventId, now)),
    cards: snapshot.cards.map((item) => toLocalCardRecord(item, lastEventId, now)),
    documents: mergeBrowserDirtyRecords(
      snapshot.documents.map((item) => toLocalDocumentRecord(item, lastEventId, now)),
      existingSnapshot.documents,
    ),
    graphLayouts: mergeBrowserDirtyRecords(
      snapshot.graphLayouts.map((item) => toLocalGraphLayoutRecord(item, lastEventId, now)),
      existingSnapshot.graphLayouts,
    ),
    attachments: snapshot.attachments.map((item) => toLocalAttachmentRecord(item, lastEventId, now)),
  }
  const savedSnapshot = saveBrowserSnapshot(workspaceId, nextSnapshot)
  emitLocalDbUpdated(workspaceId, savedSnapshot.cursor.lastEventId)
  return savedSnapshot
}

function upsertRecord<T extends { id: string }>(items: T[], nextRecord: T) {
  const existingIndex = items.findIndex((item) => item.id === nextRecord.id)
  if (existingIndex < 0) {
    return [...items, nextRecord]
  }
  return items.map((item, index) => (index === existingIndex ? nextRecord : item))
}

function removeRecord<T extends { id: string }>(items: T[], recordId: string) {
  return items.filter((item) => item.id !== recordId)
}

function toLocalKnowledgeBaseRecord(
  item: CloudBootstrapKnowledgeBase,
  lastEventId: number,
  syncedAt: string,
): LocalKnowledgeBaseRecord {
  return {
    ...cloneValue(item),
    lastEventId,
    syncedAt,
    dirtyState: 'synced',
  }
}

function toLocalCardRecord(item: CloudBootstrapCard, lastEventId: number, syncedAt: string): LocalCardRecord {
  return {
    ...cloneValue(item),
    lastEventId,
    syncedAt,
    dirtyState: 'synced',
  }
}

function toLocalDocumentRecord(
  item: CloudBootstrapDocument,
  lastEventId: number,
  syncedAt: string,
): LocalDocumentRecord {
  return {
    ...cloneValue(item),
    lastEventId,
    syncedAt,
    dirtyState: 'synced',
  }
}

function toLocalGraphLayoutRecord(
  item: CloudBootstrapGraphLayout,
  lastEventId: number,
  syncedAt: string,
): LocalGraphLayoutRecord {
  return {
    ...cloneValue(item),
    lastEventId,
    syncedAt,
    dirtyState: 'synced',
  }
}

function toLocalAttachmentRecord(
  item: CloudBootstrapAttachment,
  lastEventId: number,
  syncedAt: string,
): LocalAttachmentRecord {
  return {
    ...cloneValue(item),
    lastEventId,
    syncedAt,
    dirtyState: 'synced',
  }
}

function toLocalWorkspaceConfigRecord(
  workspaceId: string,
  item: CloudBootstrapConfig,
  lastEventId: number,
  syncedAt: string,
): LocalWorkspaceSnapshot['config'] {
  return {
    workspaceId: item.workspaceId ?? workspaceId,
    version: item.version,
    configJson: cloneValue(item.configJson),
    updatedAt: item.updatedAt,
    lastEventId,
    syncedAt,
  }
}

function preserveLocalConfig(
  existingConfig: LocalWorkspaceSnapshot['config'],
  remoteConfig: LocalWorkspaceSnapshot['config'],
) {
  if (existingConfig.updatedAt && existingConfig.syncedAt === null) {
    return {
      ...existingConfig,
      workspaceId: remoteConfig.workspaceId,
      lastEventId: remoteConfig.lastEventId,
    }
  }
  return remoteConfig
}

function applyKnowledgeBasePayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  if (eventType === 'purged') {
    return {
      ...snapshot,
      knowledgeBases: removeRecord(snapshot.knowledgeBases, String(payload.id ?? '')),
    }
  }
  return {
    ...snapshot,
    knowledgeBases: upsertRecord(
      snapshot.knowledgeBases,
        toLocalKnowledgeBaseRecord(payload as unknown as CloudBootstrapKnowledgeBase, eventId, syncedAt),
    ),
  }
}

function applyCardPayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  if (eventType === 'purged') {
    return {
      ...snapshot,
      cards: removeRecord(snapshot.cards, String(payload.id ?? '')),
    }
  }
  return {
    ...snapshot,
    cards: upsertRecord(snapshot.cards, toLocalCardRecord(payload as unknown as CloudBootstrapCard, eventId, syncedAt)),
  }
}

function applyDocumentPayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  if (eventType === 'purged') {
    return {
      ...snapshot,
      documents: removeRecord(snapshot.documents, String(payload.id ?? '')),
    }
  }
  return {
    ...snapshot,
    documents: upsertRecord(
      snapshot.documents,
      toLocalDocumentRecord(payload as unknown as CloudBootstrapDocument, eventId, syncedAt),
    ),
  }
}

function applyGraphLayoutPayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  if (eventType === 'purged') {
    return {
      ...snapshot,
      graphLayouts: removeRecord(snapshot.graphLayouts, String(payload.id ?? '')),
    }
  }
  return {
    ...snapshot,
    graphLayouts: upsertRecord(
      snapshot.graphLayouts,
      toLocalGraphLayoutRecord(payload as unknown as CloudBootstrapGraphLayout, eventId, syncedAt),
    ),
  }
}

function applyAttachmentPayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  if (eventType === 'purged') {
    return {
      ...snapshot,
      attachments: removeRecord(snapshot.attachments, String(payload.id ?? '')),
    }
  }
  return {
    ...snapshot,
    attachments: upsertRecord(
      snapshot.attachments,
      toLocalAttachmentRecord(payload as unknown as CloudBootstrapAttachment, eventId, syncedAt),
    ),
  }
}

function applyWorkspaceConfigPayload(
  snapshot: LocalWorkspaceSnapshot,
  payload: Record<string, unknown>,
  _eventType: CloudSyncPullEvent['eventType'],
  eventId: number,
  syncedAt: string,
) {
  return {
    ...snapshot,
    config: toLocalWorkspaceConfigRecord(
      snapshot.cursor.workspaceId ?? snapshot.workspace?.id ?? String(payload.workspaceId ?? ''),
      payload as unknown as CloudBootstrapConfig,
      eventId,
      syncedAt,
    ),
  }
}

function applySyncEvent(snapshot: LocalWorkspaceSnapshot, event: CloudSyncPullEvent, syncedAt: string) {
  switch (event.entityType) {
    case 'knowledge_base':
      return applyKnowledgeBasePayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    case 'card':
      return applyCardPayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    case 'document':
      return applyDocumentPayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    case 'graph_layout':
      return applyGraphLayoutPayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    case 'attachment':
      return applyAttachmentPayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    case 'workspace_config':
      return applyWorkspaceConfigPayload(snapshot, event.payload, event.eventType, event.id, syncedAt)
    default:
      return snapshot
  }
}

function applyBrowserSyncPull(payload: CloudSyncPullData): LocalWorkspaceSnapshot {
  const now = new Date().toISOString()
  let nextSnapshot = getBrowserSnapshot(payload.workspaceId)
  for (const event of payload.events) {
    nextSnapshot = applySyncEvent(nextSnapshot, event, now)
  }
  nextSnapshot = {
    ...nextSnapshot,
    cursor: {
      ...nextSnapshot.cursor,
      workspaceId: payload.workspaceId,
      lastEventId: payload.toEventId,
      lastPullAt: now,
      serverTimeAtLastPull: now,
      bootstrapCompletedAt: nextSnapshot.cursor.bootstrapCompletedAt ?? now,
    },
    config: {
      ...nextSnapshot.config,
      workspaceId: payload.workspaceId,
      lastEventId: Math.max(nextSnapshot.config.lastEventId, payload.toEventId),
      syncedAt: nextSnapshot.config.syncedAt,
    },
  }
  const savedSnapshot = saveBrowserSnapshot(payload.workspaceId, nextSnapshot)
  if (payload.events.length > 0) {
    emitLocalDbUpdated(payload.workspaceId, savedSnapshot.cursor.lastEventId)
  }
  return savedSnapshot
}

function applyBrowserSyncPushResult(
  input: LocalApplySyncPushResultInput,
): LocalWorkspaceSnapshot {
  const now = new Date().toISOString()
  let nextSnapshot = getBrowserSnapshot(input.workspaceId)
  const eventTypeByOperation: Record<CloudSyncPushSuccessData['operation'], CloudSyncPullEvent['eventType']> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    restore: 'restored',
    purge: 'purged',
  }
  nextSnapshot = applySyncEvent(
    nextSnapshot,
    {
      id: input.result.event.id,
      entityType: input.result.entityType,
      entityId: String(input.result.entity.id ?? ''),
      eventType: eventTypeByOperation[input.result.operation],
      entityVersion: input.result.event.entityVersion,
      payload: input.result.entity,
      createdAt: now,
    },
    now,
  )
  nextSnapshot = {
    ...nextSnapshot,
    cursor: {
      ...nextSnapshot.cursor,
      workspaceId: input.workspaceId,
      lastEventId: Math.max(nextSnapshot.cursor.lastEventId, input.result.event.id),
      lastPushAt: now,
      bootstrapCompletedAt: nextSnapshot.cursor.bootstrapCompletedAt ?? now,
    },
  }
  const savedSnapshot = saveBrowserSnapshot(input.workspaceId, nextSnapshot)
  emitLocalDbUpdated(input.workspaceId, savedSnapshot.cursor.lastEventId)
  return savedSnapshot
}

async function refreshBrowserSnapshot(workspaceId: string) {
  return applyBrowserBootstrap(await cloudApi.getWorkspaceBootstrap(workspaceId))
}

async function pushBrowserMutation(workspaceId: string, request: CloudSyncPushRequest) {
  try {
    const result = await cloudApi.postWorkspaceSyncPush(workspaceId, request)
    return applyBrowserSyncPushResult({
      workspaceId,
      outboxId: request.idempotencyKey,
      result,
    })
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 409) {
      await refreshBrowserSnapshot(workspaceId)
    }
    throw error
  }
}

function buildIdempotencyKey(entityType: CloudSyncEntityType, entityId: string, operation: string) {
  return `${entityType}:${entityId}:${operation}:${crypto.randomUUID()}`
}

function findSnapshotWorkspaceByDocument(documentId: string) {
  const state = readBrowserSnapshots()
  for (const [workspaceId, snapshot] of Object.entries(state)) {
    const document = snapshot.documents.find((item) => item.id === documentId)
    if (document) {
      return { workspaceId, snapshot, document }
    }
  }
  return null
}

function findSnapshotWorkspaceByCard(cardId: string) {
  const state = readBrowserSnapshots()
  for (const [workspaceId, snapshot] of Object.entries(state)) {
    const card = snapshot.cards.find((item) => item.id === cardId)
    if (card) {
      return { workspaceId, snapshot, card }
    }
  }
  return null
}

function findSnapshotWorkspaceByKnowledgeBase(knowledgeBaseId: string) {
  const state = readBrowserSnapshots()
  for (const [workspaceId, snapshot] of Object.entries(state)) {
    const knowledgeBase = snapshot.knowledgeBases.find((item) => item.id === knowledgeBaseId)
    if (knowledgeBase) {
      return { workspaceId, snapshot, knowledgeBase }
    }
  }
  return null
}

function findSnapshotWorkspaceByAttachment(attachmentId: string) {
  const state = readBrowserSnapshots()
  for (const [workspaceId, snapshot] of Object.entries(state)) {
    const attachment = snapshot.attachments.find((item) => item.id === attachmentId)
    if (attachment) {
      return { workspaceId, snapshot, attachment }
    }
  }
  return null
}

function findSnapshotWorkspaceByLayout(layoutId: string) {
  const state = readBrowserSnapshots()
  for (const [workspaceId, snapshot] of Object.entries(state)) {
    const layout = snapshot.graphLayouts.find((item) => item.id === layoutId)
    if (layout) {
      return { workspaceId, snapshot, layout }
    }
  }
  return null
}

async function createBrowserDocument(input: LocalDocumentCreateInput): Promise<LocalDocumentRecord> {
  const documentId = crypto.randomUUID()
  const snapshot = await pushBrowserMutation(input.workspaceId, {
    entityType: 'document',
    operation: 'create',
    entityId: documentId,
    baseVersion: 0,
    idempotencyKey: buildIdempotencyKey('document', documentId, 'create'),
    payload: {
      cardId: input.cardId,
      type: input.type,
      title: input.title,
      parentDocumentId: input.parentDocumentId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  })
  const document = snapshot.documents.find((item) => item.id === documentId)
  if (!document) {
    throw new Error(`Document not found after create: ${documentId}`)
  }
  return cloneValue(document)
}

async function updateBrowserDocument(input: LocalDocumentUpdateInput): Promise<LocalDocumentRecord> {
  const found = findSnapshotWorkspaceByDocument(input.documentId)
  if (!found) {
    throw new Error(`Document not found: ${input.documentId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'document',
    operation: 'update',
    entityId: input.documentId,
    baseVersion: found.document.version,
    idempotencyKey: buildIdempotencyKey('document', input.documentId, 'update-meta'),
    payload: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.parentDocumentId !== undefined ? { parentDocumentId: input.parentDocumentId } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  })
  const document = snapshot.documents.find((item) => item.id === input.documentId)
  if (!document) {
    throw new Error(`Document not found after update: ${input.documentId}`)
  }
  return cloneValue(document)
}

async function markBrowserDocumentDeleted(
  documentId: string,
  operation: 'delete' | 'restore',
): Promise<LocalDocumentRecord> {
  const found = findSnapshotWorkspaceByDocument(documentId)
  if (!found) {
    throw new Error(`Document not found: ${documentId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'document',
    operation,
    entityId: documentId,
    baseVersion: found.document.version,
    idempotencyKey: buildIdempotencyKey('document', documentId, operation),
    payload: {},
  })
  const document = snapshot.documents.find((item) => item.id === documentId)
  if (!document) {
    throw new Error(`Document not found after ${operation}: ${documentId}`)
  }
  return cloneValue(document)
}

async function purgeBrowserDocument(documentId: string) {
  const found = findSnapshotWorkspaceByDocument(documentId)
  if (!found) {
    throw new Error(`Document not found: ${documentId}`)
  }
  await pushBrowserMutation(found.workspaceId, {
    entityType: 'document',
    operation: 'purge',
    entityId: documentId,
    baseVersion: found.document.version,
    idempotencyKey: buildIdempotencyKey('document', documentId, 'purge'),
    payload: {},
  })
}

async function updateBrowserDocumentContent(
  input: LocalDocumentContentUpdateInput,
): Promise<LocalDocumentRecord> {
  const found = findSnapshotWorkspaceByDocument(input.documentId)
  if (!found) {
    throw new Error(`Document not found: ${input.documentId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'document',
    operation: 'update',
    entityId: input.documentId,
    baseVersion: found.document.version,
    idempotencyKey: buildIdempotencyKey('document', input.documentId, 'update-content'),
    payload: {
      contentJson: cloneValue(input.contentJson),
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
    },
  })
  const document = snapshot.documents.find((item) => item.id === input.documentId)
  if (!document) {
    throw new Error(`Document not found after content update: ${input.documentId}`)
  }
  return cloneValue(document)
}

async function updateBrowserWorkspaceConfig(
  input: LocalWorkspaceConfigUpdateInput,
): Promise<LocalWorkspaceSnapshot['config']> {
  const snapshot = getBrowserSnapshot(input.workspaceId)
  try {
    const response = await cloudApi.updateWorkspaceConfig(input.workspaceId, {
      baseVersion: Math.max(1, snapshot.config.version),
      configJson: cloneValue(input.configJson),
    })
    const now = new Date().toISOString()
    const nextSnapshot: LocalWorkspaceSnapshot = {
      ...snapshot,
      cursor: {
        ...snapshot.cursor,
        workspaceId: input.workspaceId,
        lastEventId: Math.max(snapshot.cursor.lastEventId, response.event.id),
        lastPushAt: now,
        bootstrapCompletedAt: snapshot.cursor.bootstrapCompletedAt ?? now,
      },
      config: toLocalWorkspaceConfigRecord(input.workspaceId, response.config, response.event.id, now),
    }
    const savedSnapshot = saveBrowserSnapshot(input.workspaceId, nextSnapshot)
    emitLocalDbUpdated(input.workspaceId, savedSnapshot.cursor.lastEventId)
    return cloneValue(savedSnapshot.config)
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 409) {
      await refreshBrowserSnapshot(input.workspaceId)
    }
    throw error
  }
}

async function updateBrowserKnowledgeBase(
  input: LocalKnowledgeBaseUpdateInput,
): Promise<LocalKnowledgeBaseRecord> {
  const found = findSnapshotWorkspaceByKnowledgeBase(input.knowledgeBaseId)
  if (!found) {
    throw new Error(`Knowledge base not found: ${input.knowledgeBaseId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'knowledge_base',
    operation: 'update',
    entityId: input.knowledgeBaseId,
    baseVersion: found.knowledgeBase.version,
    idempotencyKey: buildIdempotencyKey('knowledge_base', input.knowledgeBaseId, 'update'),
    payload: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.coverAttachmentId !== undefined ? { coverAttachmentId: input.coverAttachmentId } : {}),
    },
  })
  const knowledgeBase = snapshot.knowledgeBases.find((item) => item.id === input.knowledgeBaseId)
  if (!knowledgeBase) {
    throw new Error(`Knowledge base not found after update: ${input.knowledgeBaseId}`)
  }
  return cloneValue(knowledgeBase)
}

export interface LocalDbBridge {
  init: () => Promise<LocalDbHealth>
  health: () => Promise<LocalDbHealth>
  getPaths: () => Promise<LocalDbPaths>
  applyBootstrap: (snapshot: CloudWorkspaceBootstrap) => Promise<LocalWorkspaceSnapshot>
  applySyncPull: (payload: CloudSyncPullData) => Promise<LocalWorkspaceSnapshot>
  applySyncPushResult: (input: LocalApplySyncPushResultInput) => Promise<LocalWorkspaceSnapshot>
  getWorkspaceSnapshot: (workspaceId: string) => Promise<LocalWorkspaceSnapshot>
  listKnowledgeBases: (workspaceId: string) => Promise<LocalKnowledgeBaseRecord[]>
  updateKnowledgeBase: (input: LocalKnowledgeBaseUpdateInput) => Promise<LocalKnowledgeBaseRecord>
  deleteKnowledgeBase: (input: LocalKnowledgeBaseDeleteInput) => Promise<LocalKnowledgeBaseRecord>
  restoreKnowledgeBase: (input: LocalKnowledgeBaseDeleteInput) => Promise<LocalKnowledgeBaseRecord>
  purgeKnowledgeBase: (input: LocalKnowledgeBaseDeleteInput) => Promise<void>
  createCard: (input: LocalCardCreateInput) => Promise<LocalCardRecord>
  getCard: (cardId: string) => Promise<LocalCardRecord | null>
  updateCard: (input: LocalCardUpdateInput) => Promise<LocalCardRecord>
  deleteCard: (input: LocalCardDeleteInput) => Promise<LocalCardRecord>
  restoreCard: (input: LocalCardDeleteInput) => Promise<LocalCardRecord>
  purgeCard: (input: LocalCardDeleteInput) => Promise<void>
  createDocument: (input: LocalDocumentCreateInput) => Promise<LocalDocumentRecord>
  getDocument: (documentId: string) => Promise<LocalDocumentRecord | null>
  updateDocument: (input: LocalDocumentUpdateInput) => Promise<LocalDocumentRecord>
  deleteDocument: (input: LocalDocumentDeleteInput) => Promise<LocalDocumentRecord>
  restoreDocument: (input: LocalDocumentDeleteInput) => Promise<LocalDocumentRecord>
  purgeDocument: (input: LocalDocumentDeleteInput) => Promise<void>
  deleteAttachment: (input: LocalAttachmentDeleteInput) => Promise<LocalAttachmentRecord>
  restoreAttachment: (input: LocalAttachmentDeleteInput) => Promise<LocalAttachmentRecord>
  purgeAttachment: (input: LocalAttachmentDeleteInput) => Promise<void>
  listAttachmentsByCard: (workspaceId: string, cardId: string) => Promise<LocalAttachmentRecord[]>
  listPendingOutbox: (workspaceId: string, limit?: number) => Promise<LocalSyncOutboxItem[]>
  markOutboxItemSending: (outboxId: string) => Promise<void>
  markOutboxItemFailed: (input: LocalOutboxFailureInput) => Promise<void>
  recordSyncPushConflict: (input: LocalSyncPushConflictInput) => Promise<void>
  listSyncConflicts: (workspaceId: string, limit?: number) => Promise<LocalSyncConflictRecord[]>
  updateDocumentContent: (input: LocalDocumentContentUpdateInput) => Promise<LocalDocumentRecord>
  updateWorkspaceConfig: (input: LocalWorkspaceConfigUpdateInput) => Promise<LocalWorkspaceSnapshot['config']>
  getGraphLayout: (layoutId: string) => Promise<LocalGraphLayoutRecord | null>
  updateGraphLayout: (input: LocalGraphLayoutUpdateInput) => Promise<LocalGraphLayoutRecord>
}

async function mutateBrowserKnowledgeBase(
  knowledgeBaseId: string,
  operation: 'delete' | 'restore' | 'purge',
): Promise<LocalKnowledgeBaseRecord | void> {
  const found = findSnapshotWorkspaceByKnowledgeBase(knowledgeBaseId)
  if (!found) {
    throw new Error(`Knowledge base not found: ${knowledgeBaseId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'knowledge_base',
    operation,
    entityId: knowledgeBaseId,
    baseVersion: found.knowledgeBase.version,
    idempotencyKey: buildIdempotencyKey('knowledge_base', knowledgeBaseId, operation),
    payload: {},
  })
  if (operation === 'purge') {
    return
  }
  const knowledgeBase = snapshot.knowledgeBases.find((item) => item.id === knowledgeBaseId)
  if (!knowledgeBase) {
    throw new Error(`Knowledge base not found after ${operation}: ${knowledgeBaseId}`)
  }
  return cloneValue(knowledgeBase)
}

async function createBrowserCard(input: LocalCardCreateInput): Promise<LocalCardRecord> {
  const snapshot = await pushBrowserMutation(input.workspaceId, {
    entityType: 'card',
    operation: 'create',
    entityId: input.cardId,
    baseVersion: 0,
    idempotencyKey: buildIdempotencyKey('card', input.cardId, 'create'),
    payload: {
      kbId: input.kbId,
      parentId: input.parentId ?? null,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active',
      metaJson: cloneValue(input.metaJson ?? {}),
    },
  })
  const card = snapshot.cards.find((item) => item.id === input.cardId)
  if (!card) {
    throw new Error(`Card not found after create: ${input.cardId}`)
  }
  return cloneValue(card)
}

async function updateBrowserCard(input: LocalCardUpdateInput): Promise<LocalCardRecord> {
  const found = findSnapshotWorkspaceByCard(input.cardId)
  if (!found) {
    throw new Error(`Card not found: ${input.cardId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'card',
    operation: 'update',
    entityId: input.cardId,
    baseVersion: found.card.version,
    idempotencyKey: buildIdempotencyKey('card', input.cardId, 'update'),
    payload: {
      ...(input.name !== undefined ? { name: input.name } : {}),
    },
  })
  const card = snapshot.cards.find((item) => item.id === input.cardId)
  if (!card) {
    throw new Error(`Card not found after update: ${input.cardId}`)
  }
  return cloneValue(card)
}

async function mutateBrowserCard(
  cardId: string,
  operation: 'delete' | 'restore' | 'purge',
): Promise<LocalCardRecord | void> {
  const found = findSnapshotWorkspaceByCard(cardId)
  if (!found) {
    throw new Error(`Card not found: ${cardId}`)
  }
  const snapshot = await pushBrowserMutation(found.workspaceId, {
    entityType: 'card',
    operation,
    entityId: cardId,
    baseVersion: found.card.version,
    idempotencyKey: buildIdempotencyKey('card', cardId, operation),
    payload: {},
  })
  if (operation === 'purge') {
    return
  }
  const card = snapshot.cards.find((item) => item.id === cardId)
  if (!card) {
    throw new Error(`Card not found after ${operation}: ${cardId}`)
  }
  return cloneValue(card)
}

async function updateBrowserGraphLayout(
  input: LocalGraphLayoutUpdateInput,
): Promise<LocalGraphLayoutRecord> {
  const snapshot = getBrowserSnapshot(input.workspaceId)
  const existing = snapshot.graphLayouts.find(
    (item) =>
      item.workspaceId === input.workspaceId
      && item.kbId === input.kbId
      && (item.roomCardId ?? null) === (input.roomCardId ?? null),
  )
  const layoutId = existing?.id ?? crypto.randomUUID()
  const nextSnapshot = await pushBrowserMutation(input.workspaceId, {
    entityType: 'graph_layout',
    operation: existing ? 'update' : 'create',
    entityId: layoutId,
    baseVersion: existing?.version ?? 0,
    idempotencyKey: buildIdempotencyKey('graph_layout', layoutId, existing ? 'update' : 'create'),
    payload: {
      kbId: input.kbId,
      roomCardId: input.roomCardId ?? null,
      layoutJson: cloneValue(input.layoutJson),
      viewportJson: cloneValue(input.viewportJson),
    },
  })
  const layout = nextSnapshot.graphLayouts.find((item) => item.id === layoutId)
  if (!layout) {
    throw new Error(`Graph layout not found after save: ${layoutId}`)
  }
  return cloneValue(layout)
}

async function deleteBrowserAttachment(input: LocalAttachmentDeleteInput): Promise<LocalAttachmentRecord> {
  const found = findSnapshotWorkspaceByAttachment(input.attachmentId)
  if (!found) {
    throw new Error(`Attachment not found: ${input.attachmentId}`)
  }
  const response = await cloudApi.deleteWorkspaceAttachment(found.workspaceId, input.attachmentId)
  const now = new Date().toISOString()
  const nextSnapshot = {
    ...found.snapshot,
    cursor: {
      ...found.snapshot.cursor,
      workspaceId: found.workspaceId,
      lastEventId: Math.max(found.snapshot.cursor.lastEventId, response.event.id),
      lastPushAt: now,
      bootstrapCompletedAt: found.snapshot.cursor.bootstrapCompletedAt ?? now,
    },
    attachments: upsertRecord(
      found.snapshot.attachments,
      toLocalAttachmentRecord(response.attachment, response.event.id, now),
    ),
  }
  const savedSnapshot = saveBrowserSnapshot(found.workspaceId, nextSnapshot)
  emitLocalDbUpdated(found.workspaceId, savedSnapshot.cursor.lastEventId)
  const attachment = savedSnapshot.attachments.find((item) => item.id === input.attachmentId)
  if (!attachment) {
    throw new Error(`Attachment not found after delete: ${input.attachmentId}`)
  }
  return cloneValue(attachment)
}

const browserHealth: LocalDbHealth = {
  ready: true,
  paths: {
    rootDir: 'browser://localdb',
    dbPath: 'browser://localdb/state',
    runtimeMigrationsDir: '',
    sourceMigrationsDir: '',
  },
  migrationCount: 0,
  journalMode: 'browser',
  tables: ['workspace_snapshots'],
}

export const LocalDB: LocalDbBridge = {
  init: async () => browserHealth,
  health: async () => browserHealth,
  getPaths: async () => browserHealth.paths,
  applyBootstrap: async (snapshot) => applyBrowserBootstrap(snapshot),
  applySyncPull: async (payload) => applyBrowserSyncPull(payload),
  applySyncPushResult: async (input) => applyBrowserSyncPushResult(input),
  getWorkspaceSnapshot: async (workspaceId) => getBrowserSnapshot(workspaceId),
  listKnowledgeBases: async (workspaceId) => getBrowserSnapshot(workspaceId).knowledgeBases,
  updateKnowledgeBase: async (input) => updateBrowserKnowledgeBase(input),
  deleteKnowledgeBase: async (input) => mutateBrowserKnowledgeBase(input.knowledgeBaseId, 'delete') as Promise<LocalKnowledgeBaseRecord>,
  restoreKnowledgeBase: async (input) => mutateBrowserKnowledgeBase(input.knowledgeBaseId, 'restore') as Promise<LocalKnowledgeBaseRecord>,
  purgeKnowledgeBase: async (input) => {
    await mutateBrowserKnowledgeBase(input.knowledgeBaseId, 'purge')
  },
  createCard: async (input) => createBrowserCard(input),
  getCard: async (cardId) => {
    const found = findSnapshotWorkspaceByCard(cardId)
    return found ? cloneValue(found.card) : null
  },
  updateCard: async (input) => updateBrowserCard(input),
  deleteCard: async (input) => mutateBrowserCard(input.cardId, 'delete') as Promise<LocalCardRecord>,
  restoreCard: async (input) => mutateBrowserCard(input.cardId, 'restore') as Promise<LocalCardRecord>,
  purgeCard: async (input) => {
    await mutateBrowserCard(input.cardId, 'purge')
  },
  createDocument: async (input) => createBrowserDocument(input),
  getDocument: async (documentId) => {
    const found = findSnapshotWorkspaceByDocument(documentId)
    return found ? cloneValue(found.document) : null
  },
  updateDocument: async (input) => updateBrowserDocument(input),
  deleteDocument: async (input) => markBrowserDocumentDeleted(input.documentId, 'delete'),
  restoreDocument: async (input) => markBrowserDocumentDeleted(input.documentId, 'restore'),
  purgeDocument: async (input) => {
    await purgeBrowserDocument(input.documentId)
  },
  deleteAttachment: async (input) => deleteBrowserAttachment(input),
  restoreAttachment: async (input) => {
    const found = findSnapshotWorkspaceByAttachment(input.attachmentId)
    if (!found) {
      throw new Error(`Attachment not found: ${input.attachmentId}`)
    }
    const response = await cloudApi.restoreWorkspaceAttachment(found.workspaceId, input.attachmentId)
    const now = new Date().toISOString()
    const nextSnapshot = {
      ...applySyncEvent(found.snapshot, response.event, now),
      cursor: {
        ...found.snapshot.cursor,
        workspaceId: found.workspaceId,
        lastEventId: Math.max(found.snapshot.cursor.lastEventId, response.event.id),
        lastPushAt: now,
        bootstrapCompletedAt: found.snapshot.cursor.bootstrapCompletedAt ?? now,
      },
    }
    const savedSnapshot = saveBrowserSnapshot(found.workspaceId, nextSnapshot)
    emitLocalDbUpdated(found.workspaceId, savedSnapshot.cursor.lastEventId)
    const attachment = savedSnapshot.attachments.find((item) => item.id === input.attachmentId)
    if (!attachment) {
      throw new Error(`Attachment not found after restore: ${input.attachmentId}`)
    }
    return cloneValue(attachment)
  },
  purgeAttachment: async (input) => {
    const found = findSnapshotWorkspaceByAttachment(input.attachmentId)
    if (!found) {
      throw new Error(`Attachment not found: ${input.attachmentId}`)
    }
    const response = await cloudApi.purgeWorkspaceAttachment(found.workspaceId, input.attachmentId)
    const now = new Date().toISOString()
    const nextSnapshot = {
      ...applySyncEvent(found.snapshot, response.event, now),
      cursor: {
        ...found.snapshot.cursor,
        workspaceId: found.workspaceId,
        lastEventId: Math.max(found.snapshot.cursor.lastEventId, response.event.id),
        lastPushAt: now,
        bootstrapCompletedAt: found.snapshot.cursor.bootstrapCompletedAt ?? now,
      },
    }
    const savedSnapshot = saveBrowserSnapshot(found.workspaceId, nextSnapshot)
    emitLocalDbUpdated(found.workspaceId, savedSnapshot.cursor.lastEventId)
  },
  listAttachmentsByCard: async (workspaceId, cardId) =>
    getBrowserSnapshot(workspaceId).attachments.filter((item) => item.cardId === cardId),
  listPendingOutbox: async () => [] satisfies LocalSyncOutboxItem[],
  markOutboxItemSending: async () => undefined,
  markOutboxItemFailed: async () => undefined,
  recordSyncPushConflict: async () => undefined,
  listSyncConflicts: async () => [] satisfies LocalSyncConflictRecord[],
  updateDocumentContent: async (input) => updateBrowserDocumentContent(input),
  updateWorkspaceConfig: async (input) => updateBrowserWorkspaceConfig(input),
  getGraphLayout: async (layoutId) => {
    const found = findSnapshotWorkspaceByLayout(layoutId)
    return found ? cloneValue(found.layout) : null
  },
  updateGraphLayout: async (input) => updateBrowserGraphLayout(input),
}
