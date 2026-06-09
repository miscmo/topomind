import { useEffect, useRef, useState } from 'react'

import { handleUnauthorizedCloudSession } from '../../core/auth-session'
import { cloudApi } from '../../core/cloud-api'
import { LocalDB } from '../../core/localdb-backend'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { CLOUD_LOCALDB_UPDATED_EVENT, CLOUD_SYNC_ENGINE_WAKE_EVENT, type CloudSyncWakeDetail } from './events'
import { useCloudSyncEngineDebugStore } from './syncEngineDebugStore'

const SYNC_ENGINE_INTERVAL_MS = 15000
const SYNC_PULL_PAGE_LIMIT = 200

function emitLocalDbUpdated(workspaceId: string, lastEventId: number) {
  window.dispatchEvent(
    new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
      detail: {
        workspaceId,
        lastEventId,
      },
    }),
  )
}

interface PullCycleResult {
  appliedEventCount: number
  latestLastEventId: number
}

export function useCloudSyncEngine() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const inFlightRef = useRef(false)
  const rerunRequestedRef = useRef(false)
  const [syncError, setSyncError] = useState('')
  const [pushError, setPushError] = useState('')
  const [pullError, setPullError] = useState('')

  useEffect(() => {
    if (view !== 'workspace' || !accessToken || !currentWorkspaceId) {
      useCloudSyncEngineDebugStore.getState().patch({
        status: 'disabled',
        inFlight: false,
        currentWorkspaceId: currentWorkspaceId ?? null,
      })
      return
    }

    const requestSeq = ++requestSeqRef.current
    setSyncError('')
    setPushError('')
    setPullError('')
    rerunRequestedRef.current = false
    useCloudSyncEngineDebugStore.getState().patch({
      status: 'idle',
      inFlight: false,
      currentWorkspaceId,
      pushError: '',
      pullError: '',
      syncError: '',
    })

    const isStale = () => requestSeqRef.current !== requestSeq

    const runPullCycle = async (): Promise<PullCycleResult | null> => {
      useCloudSyncEngineDebugStore.getState().patch({
        lastPullStartedAt: new Date().toISOString(),
      })
      const baseSnapshot = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
      if (isStale()) {
        return null
      }
      if (!baseSnapshot.workspace || !baseSnapshot.cursor.bootstrapCompletedAt) {
        return {
          appliedEventCount: 0,
          latestLastEventId: baseSnapshot.cursor.lastEventId,
        }
      }

      let afterEventId = baseSnapshot.cursor.lastEventId
      let appliedEventCount = 0
      let latestLastEventId = baseSnapshot.cursor.lastEventId

      while (!isStale()) {
        const payload = await cloudApi.getWorkspaceSyncPull(currentWorkspaceId, {
          afterEventId,
          limit: SYNC_PULL_PAGE_LIMIT,
        })
        if (isStale()) {
          return null
        }

        const latestSnapshot = await LocalDB.applySyncPull(payload)
        if (isStale()) {
          return null
        }

        appliedEventCount += payload.events.length
        afterEventId = latestSnapshot.cursor.lastEventId
        latestLastEventId = latestSnapshot.cursor.lastEventId

        if (!payload.hasMore) {
          break
        }
      }

      if (appliedEventCount > 0) {
        emitLocalDbUpdated(currentWorkspaceId, latestLastEventId)
        logger.info('CloudSyncEngine', '云端增量事件已同步到本地镜像', {
          workspaceId: currentWorkspaceId,
          eventCount: appliedEventCount,
          lastEventId: latestLastEventId,
        })
      }

      useCloudSyncEngineDebugStore.getState().patch({
        lastPullFinishedAt: new Date().toISOString(),
        lastPulledCount: appliedEventCount,
      })

      return {
        appliedEventCount,
        latestLastEventId,
      }
    }

    const runSyncCycle = async (reason = 'timer') => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true
        useCloudSyncEngineDebugStore.getState().patch({
          lastWakeAt: new Date().toISOString(),
          lastTriggerReason: `${reason}:queued`,
        })
        return
      }
      inFlightRef.current = true
      useCloudSyncEngineDebugStore.getState().patch({
        status: 'running',
        inFlight: true,
        currentWorkspaceId,
        lastTriggerReason: reason,
        lastCycleStartedAt: new Date().toISOString(),
      })

      let nextSyncError = ''
      let nextPullError = ''

      try {
        try {
          await runPullCycle()
          if (isStale()) {
            return
          }
        } catch (error) {
          if (isStale()) {
            return
          }
          if (handleUnauthorizedCloudSession(error)) {
            return
          }
          nextPullError = error instanceof Error ? error.message : String(error)
          if (!nextSyncError) {
            nextSyncError = nextPullError
          }
          logger.catch('CloudSyncEngine', '执行云端 pull 周期', error)
        }

        setPushError('')
        setPullError(nextPullError)
        setSyncError(nextSyncError)
        useCloudSyncEngineDebugStore.getState().patch({
          status: 'idle',
          inFlight: false,
          currentWorkspaceId,
          lastCycleFinishedAt: new Date().toISOString(),
          pushError: '',
          pullError: nextPullError,
          syncError: nextSyncError,
        })
      } finally {
        inFlightRef.current = false
        if (!isStale() && rerunRequestedRef.current) {
          rerunRequestedRef.current = false
          void runSyncCycle('wake:rerun')
        }
      }
    }

    void runSyncCycle()
    const handleWake = (event: Event) => {
      const detail = (event as CustomEvent<CloudSyncWakeDetail>).detail
      useCloudSyncEngineDebugStore.getState().patch({
        lastWakeAt: detail?.requestedAt ?? new Date().toISOString(),
        lastTriggerReason: detail?.reason ?? 'wake',
        currentWorkspaceId,
      })
      void runSyncCycle(detail?.reason ?? 'wake')
    }
    window.addEventListener(CLOUD_SYNC_ENGINE_WAKE_EVENT, handleWake as EventListener)
    const timerId = window.setInterval(() => {
      void runSyncCycle('timer')
    }, SYNC_ENGINE_INTERVAL_MS)

    return () => {
      window.removeEventListener(CLOUD_SYNC_ENGINE_WAKE_EVENT, handleWake as EventListener)
      window.clearInterval(timerId)
      if (requestSeqRef.current === requestSeq) {
        requestSeqRef.current += 1
      }
      useCloudSyncEngineDebugStore.getState().patch({
        status: 'disabled',
        inFlight: false,
      })
    }
  }, [accessToken, currentWorkspaceId, view])

  return { syncError, pushError, pullError }
}
