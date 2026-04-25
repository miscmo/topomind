/**
 * breadcrumb.actions — 面包屑导航动作封装
 *
 * 职责：
 * 1. 统一封装导航行为（返回根级、跳转历史）
 * 2. 统一日志埋点
 * 3. 对外暴露简单接口，内部处理 Tab/非 Tab 分流
 *
 * 使用方式：
 *   const { navigateToRoot, navigateToHistory } = useBreadcrumbActions({ tabId, graph })
 */
import { useCallback } from 'react'
import { logAction } from '../../core/log-backend'

interface UseBreadcrumbActionsOptions {
  tabId?: string
  graph: {
    navigateToRoot: () => Promise<void>
    navigateToRoom: (index: number) => Promise<void>
  }
}

/**
 * 面包屑导航动作 hooks
 * 封装点击后的行为与日志，内部调用 graph.navigateToRoot / graph.navigateToRoom
 */
export function useBreadcrumbActions({
  tabId,
  graph,
}: UseBreadcrumbActionsOptions) {
  /** 返回根级 */
  const navigateToRoot = useCallback(async () => {
    logAction('房间:返回根级', 'Breadcrumb', {
      source: 'breadcrumb-root',
      tabId: tabId || '',
    })
    await graph.navigateToRoot()
  }, [tabId, graph])

  /** 跳转至历史节点 */
  const navigateToHistory = useCallback(
    async (index: number, roomName: string, roomPath: string) => {
      logAction('房间:导航', 'Breadcrumb', {
        historyIndex: index,
        roomName,
        roomPath,
        source: 'breadcrumb-history',
        tabId: tabId || '',
      })
      await graph.navigateToRoom(index)
    },
    [tabId, graph]
  )

  return { navigateToRoot, navigateToHistory }
}
