import type {
  LocalAttachmentUploadJob,
  LocalImportJobRecord,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
  SyncDebugAttachmentJobListInput,
  SyncDebugConflictListInput,
  SyncDebugImportJobListInput,
  SyncDebugResumeImportJobInput,
  SyncDebugResolveConflictUseLocalInput,
  SyncDebugRetryAttachmentJobInput,
  SyncDebugRetryOutboxInput,
  SyncDebugOutboxListInput,
  SyncDebugSnapshotResponse,
} from '../types/debug-runtime'

function unsupported(): never {
  throw new Error('后端暂未提供同步调试动作')
}

export async function getSyncDebugSnapshot(workspaceId: string): Promise<SyncDebugSnapshotResponse> {
  return {
    workspaceId,
    health: {
      ready: false,
      stage: 'web-runtime',
    },
    sync: {
      cursor: {
        lastEventId: 0,
        lastPullAt: null,
        lastPushAt: null,
      },
      outbox: {
        pendingCount: 0,
        failedCount: 0,
        openConflictCount: 0,
        conflictedCount: 0,
        nextRetryAt: null,
        oldestPendingCreatedAt: null,
      },
    },
  }
}

export async function listSyncDebugOutboxItems(
  input: SyncDebugOutboxListInput,
): Promise<LocalSyncOutboxItem[]> {
  void input
  return []
}

export async function listSyncDebugConflicts(
  input: SyncDebugConflictListInput,
): Promise<LocalSyncConflictRecord[]> {
  void input
  return []
}

export async function listSyncDebugAttachmentJobs(
  input: SyncDebugAttachmentJobListInput,
): Promise<LocalAttachmentUploadJob[]> {
  void input
  return []
}

export async function listSyncDebugImportJobs(
  input: SyncDebugImportJobListInput,
): Promise<LocalImportJobRecord[]> {
  void input
  return []
}

export async function retrySyncDebugAttachmentJob(
  input: SyncDebugRetryAttachmentJobInput,
): Promise<LocalAttachmentUploadJob> {
  void input
  unsupported()
}

export async function resumeSyncDebugImportJob(
  input: SyncDebugResumeImportJobInput,
): Promise<LocalImportJobRecord> {
  void input
  unsupported()
}

export async function retrySyncDebugOutboxItem(
  input: SyncDebugRetryOutboxInput,
): Promise<LocalSyncOutboxItem> {
  void input
  unsupported()
}

export async function resolveSyncDebugConflictUseLocal(
  input: SyncDebugResolveConflictUseLocalInput,
): Promise<LocalSyncConflictRecord> {
  void input
  unsupported()
}
