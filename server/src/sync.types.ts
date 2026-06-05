export type SyncEntityType = 'knowledge_base' | 'card' | 'document' | 'graph_layout';

export type SyncOperation = 'create' | 'update' | 'delete' | 'restore';

export type SyncEventType = 'created' | 'updated' | 'deleted' | 'restored';

export interface SyncClientInfo {
  deviceId?: string;
  requestId?: string;
  sentAt?: string;
}

export interface SyncPushRequest {
  entityType?: unknown;
  operation?: unknown;
  entityId?: unknown;
  baseVersion?: unknown;
  idempotencyKey?: unknown;
  payload?: unknown;
  client?: unknown;
}

export interface NormalizedSyncPushInput {
  workspaceId: string;
  userId: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  entityId: string;
  baseVersion: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  client: SyncClientInfo | null;
}

export interface SyncWriteResult {
  entityType: SyncEntityType;
  entityId: string;
  eventType: SyncEventType;
  entityVersion: number;
  entitySnapshot: Record<string, unknown>;
}

export interface SyncPushSuccessData {
  entityType: SyncEntityType;
  operation: SyncOperation;
  entity: Record<string, unknown>;
  event: {
    id: number;
    entityVersion: number;
  };
}

export interface SyncPullEvent {
  id: number;
  entityType: SyncEntityType;
  entityId: string;
  eventType: SyncEventType;
  entityVersion: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SyncPullData {
  workspaceId: string;
  fromEventId: number;
  toEventId: number;
  hasMore: boolean;
  events: SyncPullEvent[];
}

export interface WorkspaceBootstrapData {
  workspace: {
    id: string;
    name: string;
    role: string;
    updatedAt: string;
  };
  cursor: {
    lastEventId: number;
  };
  config: {
    version: number;
    configJson: Record<string, unknown>;
    updatedAt: string | null;
  };
  knowledgeBases: Record<string, unknown>[];
  recentDocuments: Record<string, unknown>[];
  rootLayouts: Record<string, unknown>[];
}
