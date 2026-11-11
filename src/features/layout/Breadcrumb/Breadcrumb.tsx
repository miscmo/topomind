/**
 * 房间路径：抽屉标题栏只放「首段 … 当前段」的压缩路径（控件宽度恒定），
 * 完整链路放进「位置」功能区，纵向可滚动、逐段可点击导航。
 *
 * 路径再深也不会把抽屉撑长：标题一行省略，完整路径区自带 max-height + 滚动。
 */
import { memo, useCallback, useMemo } from 'react'
import { CornerDownRight, Home } from 'lucide-react'
import { logAction } from '../../../core/log-backend'
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

/** 标题栏用的压缩表示：首段 + 省略号 + 当前段；完整串只进 tooltip。 */
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
    if (item.kind === 'root') {
      logAction('房间:返回根级', 'Breadcrumb', { source: 'status-path', tabId })
      await graph.navigateToRoot()
      return
    }
    if (item.historyIndex == null) return
    logAction('房间:导航', 'Breadcrumb', {
      historyIndex: item.historyIndex,
      roomName: item.label,
      roomPath: item.path,
      source: 'status-path',
      tabId,
    })
    await graph.navigateToRoom(item.historyIndex)
  }, [tabId, graph])
}

/** 完整路径列表：纵向、逐段可点、超长内部滚动，不改变抽屉尺寸。 */
export default memo(function RoomPathList({ tabId }: { tabId: string }) {
  const items = useRoomPathItems(tabId)
  const navigate = useRoomPathNavigate(tabId)

  if (items.length === 0) {
    return <div className="px-1 py-1 text-[11px] text-[var(--color-text-secondary)]">当前没有房间路径</div>
  }

  return (
    <div
      data-tm-room-path-list=""
      data-tm-room-path-count={items.length}
      className="flex max-h-40 flex-col gap-0.5 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)]"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <button
            key={item.id}
            type="button"
            data-tm-room-path-item={item.path}
            disabled={isLast}
            title={item.label}
            onClick={() => { void navigate(item) }}
            className={`nodrag nowheel flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] ${
              isLast
                ? 'cursor-default font-semibold text-[var(--color-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'
            }`}
          >
            {index === 0
              ? <Home className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              : <CornerDownRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {isLast && <span className="shrink-0 text-[10px] font-normal opacity-70">当前</span>}
          </button>
        )
      })}
    </div>
  )
})
