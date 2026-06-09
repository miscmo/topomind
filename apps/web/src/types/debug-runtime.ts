import type {
  LocalAttachmentUploadJob,
  LocalImportJobRecord,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
} from './local-sync'

export interface FileCacheDirectoryStatus {
  key: string
  label: string
  directoryPath: string
  exists: boolean
}

export interface FileCacheHealth {
  ready: boolean
  provider: string
  paths: {
    rootDir: string
  }
  directories: FileCacheDirectoryStatus[]
}

export interface AttachmentDebugHealthResponse {
  ready: boolean
  stage: string
  currentAttachmentJobId: string | null
  processing: boolean
  supportedChannels: string[]
  lastError: string | null
  cloudSession: {
    hasAccessToken: boolean
    hasRefreshToken: boolean
    userId: string | null
  } | null
}

export interface ImportDebugHealthResponse {
  ready: boolean
  stage: string
  currentImportJobId: string | null
  processing: boolean
  supportedChannels: string[]
  lastError: string | null
}

export interface SyncDebugSnapshotResponse {
  workspaceId: string
  health: {
    ready: boolean
    stage: string
  }
  sync: {
    cursor: {
      lastEventId: number
      lastPullAt: string | null
      lastPushAt: string | null
    }
    outbox: {
      pendingCount: number
      failedCount: number
      openConflictCount: number
      conflictedCount: number
      nextRetryAt: string | null
      oldestPendingCreatedAt: string | null
    }
  }
}

export interface SyncDebugOutboxListInput {
  workspaceId: string
  limit?: number
  statuses?: LocalSyncOutboxItem['status'][]
}

export interface SyncDebugConflictListInput {
  workspaceId: string
  limit?: number
  statuses?: LocalSyncConflictRecord['status'][]
}

export interface SyncDebugAttachmentJobListInput {
  workspaceId: string
  limit?: number
  statuses?: LocalAttachmentUploadJob['status'][]
}

export interface SyncDebugImportJobListInput {
  workspaceId: string
  limit?: number
  statuses?: LocalImportJobRecord['status'][]
}

export interface SyncDebugRetryAttachmentJobInput {
  attachmentJobId: string
}

export interface SyncDebugResumeImportJobInput {
  importJobId: string
}

export interface SyncDebugRetryOutboxInput {
  outboxId: string
}

export interface SyncDebugResolveConflictUseLocalInput {
  conflictId: string
}

export type {
  LocalAttachmentUploadJob,
  LocalImportJobRecord,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
}
