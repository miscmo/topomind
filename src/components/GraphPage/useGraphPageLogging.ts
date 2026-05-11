import { useEffect } from 'react'
import { logAction } from '../../core/log-backend'

export interface UseGraphPageLoggingOptions {
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId: string
}

export function useGraphPageLogging(options: UseGraphPageLoggingOptions) {
  const { effectiveRoomPath, effectiveKbPath, tabId } = options

  useEffect(() => {
    logAction('页面:进入图谱', 'GraphPage', {
      currentRoomPath: effectiveRoomPath || '',
      currentKBPath: effectiveKbPath || '',
      tabId,
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId])
}
