import { useEffect, useRef, useState } from 'react'

import { CloudApiError, cloudApi } from '../../core/cloud-api'
import { LocalDB } from '../../core/localdb-backend'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { CLOUD_LOCALDB_UPDATED_EVENT } from './events'

const SYNC_PUSH_INTERVAL_MS = 15000
const SYNC_PUSH_RETRY_BASE_MS = 15000

function getRetryDelayMs(attemptCount: number) {
  const normalizedAttempts = Number.isFinite(attemptCount) ? Math.max(0, attemptCount) : 0
  return Math.min(SYNC_PUSH_RETRY_BASE_MS * Math.max(1, 2 ** normalizedAttempts), 5 * 60 * 1000)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toNullablePositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function toNullableNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function isConflictError(error: unknown): error is CloudApiError {
  return error instanceof CloudApiError && error.status === 409
}

export function useCloudPushSync() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const inFlightRef = useRef(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    if (view !== 'workspace' || !accessToken || !currentWorkspaceId) {
      return
    }

    const requestSeq = ++requestSeqRef.current
    setPushError('')

    const runPush = async () => {
      if (inFlightRef.current) {
        return
      }
      inFlightRef.current = true

      let pushedCount = 0
      let latestLastEventId = 0
      let latestNonFatalError = ''

      try {
        const snapshot = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
        if (requestSeqRef.current !== requestSeq) {
          return
        }
        if (!snapshot.workspace || !snapshot.cursor.bootstrapCompletedAt) {
          return
        }

        const pendingOutboxItems = await LocalDB.listPendingOutbox(currentWorkspaceId, 50)

        for (const outboxItem of pendingOutboxItems) {
          if (requestSeqRef.current !== requestSeq) {
            return
          }

          await LocalDB.markOutboxItemSending(outboxItem.id)

          try {
            const result = await cloudApi.postWorkspaceSyncPush(currentWorkspaceId, {
              entityType: outboxItem.entityType,
              operation: outboxItem.operation,
              entityId: outboxItem.entityId,
              baseVersion: outboxItem.baseVersion,
              idempotencyKey: outboxItem.idempotencyKey,
              payload: outboxItem.payloadJson,
              client: {
                requestId: crypto.randomUUID(),
                sentAt: new Date().toISOString(),
              },
            })

            const localSnapshot = await LocalDB.applySyncPushResult({
              workspaceId: currentWorkspaceId,
              outboxId: outboxItem.id,
              result,
            })
            if (requestSeqRef.current !== requestSeq) {
              return
            }

            pushedCount += 1
            latestLastEventId = localSnapshot.cursor.lastEventId
          } catch (error) {
            if (isConflictError(error)) {
              const details = isPlainRecord(error.details) ? error.details : {}
              await LocalDB.recordSyncPushConflict({
                workspaceId: currentWorkspaceId,
                outboxId: outboxItem.id,
                errorCode: error.code,
                errorMessage: error.message,
                serverVersion: toNullablePositiveInteger(details.serverVersion),
                serverEventId: toNullableNonNegativeInteger(details.serverEventId),
                serverEntityJson: isPlainRecord(details.serverEntity) ? details.serverEntity : {},
              })
              latestNonFatalError = error.message
              logger.warn('CloudPush', '推送项发生冲突，已写入本地冲突记录', {
                workspaceId: currentWorkspaceId,
                outboxId: outboxItem.id,
                entityType: outboxItem.entityType,
                entityId: outboxItem.entityId,
                errorCode: error.code,
              })
              continue
            }

            const message = error instanceof Error ? error.message : String(error)
            await LocalDB.markOutboxItemFailed({
              outboxId: outboxItem.id,
              errorCode: 'push_failed',
              errorMessage: message,
              nextRetryAt: new Date(Date.now() + getRetryDelayMs(outboxItem.attemptCount)).toISOString(),
            })
            throw error
          }
        }

        setPushError(latestNonFatalError)
      } catch (error) {
        if (requestSeqRef.current !== requestSeq) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setPushError(message)
        logger.catch('CloudPush', '推送本地脏文档到云端', error)
      } finally {
        if (requestSeqRef.current === requestSeq && pushedCount > 0) {
          window.dispatchEvent(
            new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
              detail: {
                workspaceId: currentWorkspaceId,
                lastEventId: latestLastEventId,
              },
            }),
          )
          logger.info('CloudPush', '本地脏文档已推送并回写到本地镜像', {
            workspaceId: currentWorkspaceId,
            documentCount: pushedCount,
            lastEventId: latestLastEventId,
          })
        }
        inFlightRef.current = false
      }
    }

    void runPush()
    const timerId = window.setInterval(() => {
      void runPush()
    }, SYNC_PUSH_INTERVAL_MS)

    return () => {
      window.clearInterval(timerId)
      if (requestSeqRef.current === requestSeq) {
        requestSeqRef.current += 1
      }
    }
  }, [accessToken, currentWorkspaceId, view])

  return { pushError }
}
