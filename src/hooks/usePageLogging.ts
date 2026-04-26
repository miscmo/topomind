/**
 * 页面日志记录钩子
 * 监听视图切换，当进入 GraphPage 时记录日志。
 * 用于页面访问追踪和用户行为分析。
 */
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
