import { useEffect } from 'react'

import { clearCloudSessionInMain, syncCloudSessionToMain } from '../../core/cloud-session-backend'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'

export function useCloudSessionBridge() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const refreshToken = useCloudSessionStore((s) => s.refreshToken)
  const userId = useCloudSessionStore((s) => s.user?.id ?? null)

  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      try {
        if (!accessToken) {
          await clearCloudSessionInMain()
          return
        }
        await syncCloudSessionToMain({
          accessToken,
          refreshToken,
          userId,
        })
      } catch (error) {
        if (!cancelled) {
          logger.warn('CloudSessionBridge', '同步主进程云会话失败', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void sync()

    return () => {
      cancelled = true
    }
  }, [accessToken, refreshToken, userId])
}
