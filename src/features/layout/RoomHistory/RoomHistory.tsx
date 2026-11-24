/**
 * 「最近打开」功能区内容：只负责列表渲染与激活，折叠状态由画布状态抽屉统一管。
 * 列表高度自带上限，房间再长也不会把抽屉撑高。
 */
import { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, memo, useCallback, useMemo, useRef } from 'react'
import { History } from 'lucide-react'
import { useRoomHistoryList, type RoomHistoryRecord } from '../../../hooks/useRoomHistory'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { logAction } from '../../../core/log-backend'

function activateOnEnterOrSpace(handler: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handler()
    }
  }
}

/** 抽屉只订阅一次：数量给分区徽标，激活回调给列表。 */
export function useRecentRooms(tabId: string) {
  const graph = useGraphContext()
  const tab = useTabStore(s => s.getTabById(tabId))
  const kbPath = tab?.type === 'kb' ? tab.kbPath : null
  const kbLabel = tab?.type === 'kb' ? tab.label : null
  const currentRoomPath = tab?.type === 'kb' ? tab.currentRoomPath : null
  const items = useRoomHistoryList(kbPath, kbLabel, currentRoomPath)

  const onActivate = useCallback(async (item: RoomHistoryRecord) => {
    if (!kbPath) return
    logAction('room.navigate', 'RoomHistory', {
      targetPath: item.path,
      targetName: item.name,
      tabId,
    })
    if (item.path === kbPath) {
      await graph.navigateToRoot()
    } else {
      useTabStore.getState().restoreRoomStateToTab(tabId, {
        kbPath,
        roomHistory: item.historyStack || [],
        currentRoomPath: item.path,
        currentRoomName: item.name,
      })
      await graph.loadRoom(item.path)
    }
  }, [kbPath, tabId, graph])

  return { items, activePath: currentRoomPath, onActivate }
}

function useDragAwareClick<T>(onActivate: (item: T) => void, threshold = 4) {
  const dragStateRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    dragStateRef.current = { x: event.clientX, y: event.clientY, moved: false }
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = dragStateRef.current
    if (!state || state.moved) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (dx * dx + dy * dy > threshold * threshold) state.moved = true
  }, [threshold])

  const endDrag = useCallback((): boolean => {
    const state = dragStateRef.current
    dragStateRef.current = null
    return state?.moved ?? false
  }, [])

  const onClick = useCallback((event: ReactMouseEvent<HTMLElement>, item: T) => {
    if (endDrag()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    onActivate(item)
  }, [endDrag, onActivate])

  return { onPointerDown, onPointerMove, endDrag, onClick }
}

interface RoomHistoryItemProps {
  item: RoomHistoryRecord
  active: boolean
  onActivate: (item: RoomHistoryRecord) => void
}

const RoomHistoryItem = memo(function RoomHistoryItem({ item, active, onActivate }: RoomHistoryItemProps) {
  const { onPointerDown, onPointerMove, endDrag, onClick } = useDragAwareClick(onActivate)
  const onKeyDown = useMemo(() => activateOnEnterOrSpace(() => onActivate(item)), [onActivate, item])
  const display = item.display || item.name

  return (
    <div
      role="button"
      tabIndex={0}
      data-tm-recent-room={item.path}
      className={`nodrag nowheel flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors group ${
        active
          ? 'bg-[var(--color-hover-bg)] font-semibold text-[var(--color-accent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(event) => onClick(event, item)}
      onKeyDown={onKeyDown}
      title={display}
    >
      <History className={`h-3 w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate leading-4">{display}</span>
    </div>
  )
})

interface RoomHistoryProps {
  items: RoomHistoryRecord[]
  activePath: string | null
  onActivate: (item: RoomHistoryRecord) => void
}

export default memo(function RoomHistory({ items, activePath, onActivate }: RoomHistoryProps) {
  if (items.length === 0) {
    return <div className="px-1 py-1 text-[11px] text-[var(--color-text-secondary)]">暂无最近打开的房间</div>
  }

  return (
    <div
      data-tm-recent-room-list=""
      className="flex max-h-44 flex-col gap-0.5 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)]"
    >
      {items.map((item) => (
        <RoomHistoryItem key={item.path} item={item} active={item.path === activePath} onActivate={onActivate} />
      ))}
    </div>
  )
})
