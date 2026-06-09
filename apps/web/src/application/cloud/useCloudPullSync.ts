import { useEffect, useRef, useState } from 'react'

import { cloudApi } from '../../core/cloud-api'
import { LocalDB } from '../../core/localdb-backend'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { CLOUD_LOCALDB_UPDATED_EVENT } from './events'

const SYNC_PULL_INTERVAL_MS = 15000
const SYNC_PULL_PAGE_LIMIT = 200

export function useCloudPullSync() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const inFlightRef = useRef(false)
  const [pullError, setPullError] = useState('')

  useEffect(() => {
    if (view !== 'workspace' || !accessToken || !currentWorkspaceId) {
      return
    }

    const requestSeq = ++requestSeqRef.current
    setPullError('')

    const runPull = async () => {
      if (inFlightRef.current) {
        return
      }
      inFlightRef.current = true
      try {
        const baseSnapshot = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
        if (requestSeqRef.current !== requestSeq) {
          return
        }
        if (!baseSnapshot.workspace || !baseSnapshot.cursor.bootstrapCompletedAt) {
          return
        }

        let afterEventId = baseSnapshot.cursor.lastEventId
        let appliedEventCount = 0
        let latestSnapshot = baseSnapshot

        while (requestSeqRef.current === requestSeq) {
          const payload = await cloudApi.getWorkspaceSyncPull(currentWorkspaceId, {
            afterEventId,
            limit: SYNC_PULL_PAGE_LIMIT,
          })
          if (requestSeqRef.current !== requestSeq) {
            return
          }

          latestSnapshot = await LocalDB.applySyncPull(payload)
          if (requestSeqRef.current !== requestSeq) {
            return
          }

          appliedEventCount += payload.events.length
          afterEventId = latestSnapshot.cursor.lastEventId

          if (!payload.hasMore) {
            break
          }
        }

        setPullError('')
        if (appliedEventCount > 0) {
          window.dispatchEvent(
            new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
              detail: {
                workspaceId: currentWorkspaceId,
                lastEventId: latestSnapshot.cursor.lastEventId,
              },
            }),
          )
          logger.info('CloudPull', '云端增量事件已同步到本地镜像', {
            workspaceId: currentWorkspaceId,
            eventCount: appliedEventCount,
            lastEventId: latestSnapshot.cursor.lastEventId,
          })
        }
      } catch (error) {
        if (requestSeqRef.current !== requestSeq) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setPullError(message)
        logger.catch('CloudPull', '同步云端增量事件', error)
      } finally {
        inFlightRef.current = false
      }
    }

    void runPull()
    const timerId = window.setInterval(() => {
      void runPull()
    }, SYNC_PULL_INTERVAL_MS)

    return () => {
      window.clearInterval(timerId)
      if (requestSeqRef.current === requestSeq) {
        requestSeqRef.current += 1
      }
    }
  }, [accessToken, currentWorkspaceId, view])

  return { pullError }
}
