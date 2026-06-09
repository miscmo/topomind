import { useEffect, useRef, useState } from 'react'

import { handleUnauthorizedCloudSession } from '../../core/auth-session'
import { cloudApi } from '../../core/cloud-api'
import { LocalDB } from '../../core/localdb-backend'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { CLOUD_LOCALDB_UPDATED_EVENT } from './events'

const BOOTSTRAP_RETRY_BASE_DELAY_MS = 2000
const BOOTSTRAP_RETRY_MAX_DELAY_MS = 30000

export function useCloudBootstrapSync() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const retryAttemptRef = useRef(0)
  const [bootstrapError, setBootstrapError] = useState('')

  useEffect(() => {
    if (view !== 'workspace' || !accessToken || !currentWorkspaceId) {
      retryAttemptRef.current = 0
      return
    }

    const requestSeq = ++requestSeqRef.current
    let retryTimerId: number | null = null
    setBootstrapError('')

    const isStale = () => requestSeqRef.current !== requestSeq

    const runBootstrap = async () => {
      try {
        const snapshot = await LocalDB.applyBootstrap(
          await cloudApi.getWorkspaceBootstrap(currentWorkspaceId),
        )
        if (isStale()) {
          return
        }
        retryAttemptRef.current = 0
        window.dispatchEvent(
          new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
            detail: {
              workspaceId: currentWorkspaceId,
              lastEventId: snapshot.cursor.lastEventId,
            },
          }),
        )
        logger.info('CloudBootstrap', '云端 bootstrap 已同步到本地镜像', {
          workspaceId: currentWorkspaceId,
          kbCount: snapshot.knowledgeBases.length,
          cardCount: snapshot.cards.length,
          documentCount: snapshot.documents.length,
          layoutCount: snapshot.graphLayouts.length,
          attachmentCount: snapshot.attachments.length,
          lastEventId: snapshot.cursor.lastEventId,
        })
      } catch (error) {
        if (isStale()) {
          return
        }
        if (handleUnauthorizedCloudSession(error)) {
          retryAttemptRef.current = 0
          setBootstrapError('')
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setBootstrapError(message)
        logger.catch('CloudBootstrap', '同步云端 bootstrap', error)
        const delayMs = Math.min(
          BOOTSTRAP_RETRY_MAX_DELAY_MS,
          BOOTSTRAP_RETRY_BASE_DELAY_MS * (2 ** retryAttemptRef.current),
        )
        retryAttemptRef.current += 1
        retryTimerId = window.setTimeout(() => {
          if (!isStale()) {
            void runBootstrap()
          }
        }, delayMs)
      }
    }

    void runBootstrap()

    return () => {
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId)
      }
      if (requestSeqRef.current === requestSeq) {
        requestSeqRef.current += 1
      }
    }
  }, [accessToken, currentWorkspaceId, view])

  return { bootstrapError }
}
