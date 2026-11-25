/**
 * 画布左上角房间路径面包屑：横向、逐段可点击，不用展开任何面板就能跳房间。
 *
 * - 唯一路径来源仍是「知识库根 → 历史栈 → 当前房间」，与标题 tooltip 共用一份数据。
 * - 路径再长也不撑高面板：整条面包屑在固定宽度里横向滚动，每一段始终能直接点。
 * - 导航同时补一条语义化 user.room_enter 事件，进入房间的意图不被埋点遗漏。
 */
import { memo, useCallback, useMemo } from 'react'
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

function useRoomPathNavigate(tabId: string) {
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

/** 横向面包屑：除当前段外每一段都可点击直达，长路径在容器内横向滚动。 */
export default memo(function RoomPathBreadcrumb({ tabId }: { tabId: string }) {
  const items = useRoomPathItems(tabId)
  const navigate = useRoomPathNavigate(tabId)

  if (items.length === 0) {
    return <div className="tm-hint min-w-0 flex-1 truncate">当前没有房间路径</div>
  }

  return (
    <div
      data-tm-room-path-list=""
      data-tm-room-path-count={items.length}
      className="nodrag nowheel tm-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:h-1"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={item.id} className="inline-flex min-w-0 shrink-0 items-center gap-1">
            {index > 0 && <span className="tm-hint shrink-0 opacity-60">›</span>}
            <button
              type="button"
              data-tm-room-path-item={item.path}
              disabled={isLast}
              title={item.label}
              aria-current={isLast ? 'page' : undefined}
              onClick={() => { void navigate(item) }}
              className={`nodrag nowheel tm-hint max-w-[112px] truncate rounded px-0.5 ${
                isLast
                  ? 'cursor-default font-semibold text-[var(--color-primary)]'
                  : 'font-medium text-[var(--color-accent)] hover:underline'
              }`}
            >
              {item.label}
            </button>
            {isLast && <span className="tm-hint shrink-0 opacity-70">当前</span>}
          </span>
        )
      })}
    </div>
  )
})
