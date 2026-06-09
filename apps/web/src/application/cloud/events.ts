export const CLOUD_LOCALDB_UPDATED_EVENT = 'topomind:cloud-localdb-updated'
export const CLOUD_SYNC_ENGINE_WAKE_EVENT = 'topomind:cloud-sync-engine-wake'

export interface CloudSyncWakeDetail {
  reason: string
  requestedAt: string
}

export function requestCloudSyncWake(reason = 'manual') {
  const detail: CloudSyncWakeDetail = {
    reason,
    requestedAt: new Date().toISOString(),
  }
  window.dispatchEvent(
    new CustomEvent(CLOUD_SYNC_ENGINE_WAKE_EVENT, {
      detail,
    }),
  )
}
