import { cloudApi } from '../../core/cloud-api'
import { LocalDB } from '../../core/localdb-backend'
import { CLOUD_LOCALDB_UPDATED_EVENT } from './events'

export async function syncWorkspacePullIntoLocalMirror(workspaceId: string) {
  const baseSnapshot = await LocalDB.getWorkspaceSnapshot(workspaceId)
  if (!baseSnapshot.workspace || !baseSnapshot.cursor.bootstrapCompletedAt) {
    const bootstrapSnapshot = await LocalDB.applyBootstrap(
      await cloudApi.getWorkspaceBootstrap(workspaceId),
    )
    dispatchCloudLocalDbUpdated(workspaceId, bootstrapSnapshot.cursor.lastEventId)
    return bootstrapSnapshot
  }

  let afterEventId = baseSnapshot.cursor.lastEventId
  let latestSnapshot = baseSnapshot
  let appliedEventCount = 0

  while (true) {
    const payload = await cloudApi.getWorkspaceSyncPull(workspaceId, {
      afterEventId,
      limit: 200,
    })
    latestSnapshot = await LocalDB.applySyncPull(payload)
    appliedEventCount += payload.events.length
    afterEventId = latestSnapshot.cursor.lastEventId
    if (!payload.hasMore) {
      break
    }
  }

  if (appliedEventCount > 0) {
    dispatchCloudLocalDbUpdated(workspaceId, latestSnapshot.cursor.lastEventId)
  }

  return latestSnapshot
}

export function dispatchCloudLocalDbUpdated(workspaceId: string, lastEventId?: number) {
  window.dispatchEvent(
    new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
      detail: {
        workspaceId,
        ...(typeof lastEventId === 'number' ? { lastEventId } : {}),
      },
    }),
  )
}
