import { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, History } from 'lucide-react'
import { useRoomHistoryList, type RoomHistoryRecord } from '../../../hooks/useRoomHistory'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { logAction } from '../../../core/log-backend'

interface RoomHistoryProps {
  tabId: string
}

const COLLAPSED_STORAGE_KEY = 'topomind_room_history_collapsed'

function usePersistedCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const update = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
    } catch {
      // 忽略持久化失败
    }
  }, [])

  // 跨 tab 同步折叠状态
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== COLLAPSED_STORAGE_KEY) return
      setCollapsed(event.newValue === 'true')
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  return [collapsed, update]
}

function activateOnEnterOrSpace(handler: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handler()
    }
  }
}

interface RoomHistoryHeaderProps {
  collapsed: boolean
  count: number
  onToggle: () => void
}

const RoomHistoryHeader = memo(function RoomHistoryHeader({ collapsed, count, onToggle }: RoomHistoryHeaderProps) {
  const onKeyDown = useMemo(() => activateOnEnterOrSpace(onToggle), [onToggle])
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--color-border-subtle)] text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider shrink-0 bg-black/5 cursor-pointer select-none hover:bg-[var(--color-hover-bg)] transition-colors whitespace-nowrap"
      onClick={onToggle}
      onKeyDown={onKeyDown}
      title={collapsed ? '展开最近打开' : '折叠最近打开'}
    >
      {collapsed ? (
        <ChevronRight className="w-3 h-3 opacity-70" />
      ) : (
        <ChevronDown className="w-3 h-3 opacity-70" />
      )}
      <Clock className="w-3 h-3 opacity-70" />
      <span>最近打开</span>
      <span className="text-[10px] font-normal opacity-60">{count}</span>
    </div>
  )
})

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
    if (dx * dx + dy * dy > threshold * threshold) {
      state.moved = true
    }
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
      className={`flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs rounded-md transition-colors cursor-pointer border-none bg-transparent group ${
        active
          ? 'text-[var(--color-primary)] bg-[var(--color-hover-bg)] font-semibold'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-hover-bg)]'
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(event) => onClick(event, item)}
      onKeyDown={onKeyDown}
      title={display}
    >
      <History className={`w-3.5 h-3.5 shrink-0 ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} />
      <span className="flex-1 font-medium select-text break-all leading-5">{display}</span>
    </div>
  )
})

interface RoomHistoryListProps {
  items: RoomHistoryRecord[]
  activePath: string | null
  onActivate: (item: RoomHistoryRecord) => void
}

const RoomHistoryList = memo(function RoomHistoryList({ items, activePath, onActivate }: RoomHistoryListProps) {
  return (
    <div className="flex-1 overflow-y-auto py-1 px-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-text-muted)]">
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <RoomHistoryItem
            key={item.path}
            item={item}
            active={item.path === activePath}
            onActivate={onActivate}
          />
        ))}
      </div>
    </div>
  )
})

export default memo(function RoomHistory({ tabId }: RoomHistoryProps) {
  const graph = useGraphContext()
  const tab = useTabStore(s => s.getTabById(tabId))

  const kbPath = tab?.type === 'kb' ? tab.kbPath : null
  const kbLabel = tab?.type === 'kb' ? tab.label : null
  const currentRoomPath = tab?.type === 'kb' ? tab.currentRoomPath : null

  const historyList = useRoomHistoryList(kbPath, kbLabel, currentRoomPath)
  const [collapsed, setCollapsed] = usePersistedCollapsed()

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed)
  }, [collapsed, setCollapsed])

  const handleActivate = useCallback(async (item: RoomHistoryRecord) => {
    if (!kbPath) return
    logAction('房间历史:快捷导航', 'RoomHistory', {
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
        currentRoomName: item.name
      })
      await graph.loadRoom(item.path)
    }
  }, [kbPath, tabId, graph])

  if (historyList.length === 0) {
    return null
  }

  // 折叠态：自适应宽度；展开态：固定 240px 以容纳较长路径
  const widthClass = collapsed ? 'w-auto min-w-[160px]' : 'w-[240px] max-h-[260px]'

  return (
    <div
      className={`flex flex-col ${widthClass} overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-md)] backdrop-blur-xl`}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
    >
      <RoomHistoryHeader collapsed={collapsed} count={historyList.length} onToggle={toggleCollapsed} />
      {!collapsed && (
        <RoomHistoryList items={historyList} activePath={currentRoomPath} onActivate={handleActivate} />
      )}
    </div>
  )
})
