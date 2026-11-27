/**
 * 房间路径的唯一数据 / 导航来源（不含任何 UI）。
 *
 * - 路径由「知识库根 → 历史栈 → 当前房间」派生，去重、不重复当前房间。
 * - `useRoomPathItems().length > 1` 等价于「已进入二层或更深房间」，
 *   画布顶部的新面包屑只在这个条件下渲染（根房间不留任何浮层）。
 * - 导航同时补一条语义化 user.room_enter 事件，进入房间的意图不被埋点遗漏。
 * - 可见面包屑组件在 `GraphCanvas/components/RoomBreadcrumb.tsx`；
 *   旧版左上角状态抽屉（最近打开 / 撤销前进 / 查看深度）已整体下线。
 */
import { useCallback, useMemo } from 'react'
import { logAction } from '../../../core/log-backend'
import { recordUser } from '../../../core/observe'
import { LOG_ACTIONS } from '../../../shared/observability/logContract'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useTabStore } from '../../../stores/tabs/tabStore'

export interface RoomPathItem {
  id: string
  label: string
  path: string
  kind: 'root' | 'history' | 'current'
  historyIndex?: number
}

/** 唯一路径来源：知识库根 → 历史栈 → 当前房间，去重、不重复当前房间。 */
export function useRoomPathItems(tabId: string): RoomPathItem[] {
  const tab = useTabStore(s => s.getTabById(tabId))

  return useMemo<RoomPathItem[]>(() => {
    if (!tab || tab.type !== 'kb' || !tab.kbPath || !tab.currentRoomPath) return []

    const items: RoomPathItem[] = [
      { id: `root:${tab.kbPath}`, label: tab.label || '知识库', path: tab.kbPath, kind: 'root' },
    ]
    const seenPaths = new Set<string>([tab.kbPath])
    const currentPath = tab.currentRoomPath

    for (const [historyIndex, historyItem] of (tab.roomHistory ?? []).entries()) {
      const room = historyItem.room
      if (!room.path || room.path === tab.kbPath || room.path === currentPath || seenPaths.has(room.path)) continue
      seenPaths.add(room.path)
      items.push({
        id: `history:${room.path}`,
        label: room.name,
        path: room.path,
        kind: 'history',
        historyIndex,
      })
    }

    if (currentPath !== tab.kbPath) {
      items.push({
        id: `current:${currentPath}`,
        label: tab.currentRoomName || currentPath,
        path: currentPath,
        kind: 'current',
      })
    }
    return items
  }, [tab])
}

/** 完整路径串：只进 tooltip / 断言属性，不参与面包屑布局。 */
export function compactRoomPath(items: RoomPathItem[]) {
  const full = items.map(item => item.label).join(' / ')
  const current = items.length > 1 ? items[items.length - 1].label : ''
  return {
    full,
    lead: items[0]?.label ?? '',
    current,
    hasMiddle: items.length > 2,
    count: items.length,
  }
}

/** 面包屑逐段跳转：根段回根，历史段截断到该层，当前段不导航。 */
export function useRoomPathNavigate(tabId: string) {
  const graph = useGraphContext()
  return useCallback(async (item: RoomPathItem) => {
    if (item.kind !== 'root' && item.historyIndex == null) return
    void logAction('room.navigate', 'Breadcrumb', {
      historyIndex: item.historyIndex,
      roomName: item.label,
      roomPath: item.path,
      source: item.kind === 'root' ? 'breadcrumb-root' : 'breadcrumb-history',
      tabId,
    })
    void recordUser(LOG_ACTIONS.userRoomEnter, {
      target: { type: 'room', id: item.path, label: item.label },
      view: 'canvas',
      inputMode: 'click',
      params: { roomPath: item.path, source: 'breadcrumb', tabId },
    })
    if (item.kind === 'root') {
      await graph.navigateToRoot()
      return
    }
    await graph.navigateToRoom(item.historyIndex!)
  }, [tabId, graph])
}
