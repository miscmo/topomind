import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { logAction } from '../core/log-backend'

export interface UsePageLoggingOptions {
  view: string
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId?: string
}

export function usePageLogging(options: UsePageLoggingOptions) {
  const { view, effectiveRoomPath, effectiveKbPath, tabId } = options

  useEffect(() => {
    if (view === 'graph') {
      logAction('页面:进入图谱', 'GraphPage', {
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
    }
  }, [view, effectiveRoomPath, effectiveKbPath, tabId])
}
