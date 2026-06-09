/**
 * 面包屑导航组件
 * 显示当前画布层级：知识库根 > 父节点 > ... > 当前节点
 */
import { memo, useCallback, useMemo } from 'react'
import { logAction } from '../../../core/log-backend'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useTabStore } from '../../../stores/tabs/tabStore'

interface BreadcrumbProps {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId: string
}

interface BreadcrumbItem {
  id: string
  label: string
  kind: 'root' | 'history' | 'current'
  historyIndex?: number
}

export default memo(function Breadcrumb({ tabId }: BreadcrumbProps) {
  const graph = useGraphContext()
  const tab = useTabStore((s: any) => s.getTabById(tabId))

  const items = useMemo<BreadcrumbItem[]>(() => {
    if (!tab || tab.type !== 'kb' || !tab.kbId || !tab.currentRoomId) return []

    const items: BreadcrumbItem[] = [
      {
        id: `root:${tab.kbId}`,
        label: tab.label || '知识库',
        kind: 'root',
      },
    ]

    const seenRoomIds = new Set<string>([tab.currentRoomId, tab.kbId].filter(Boolean))

    for (const [historyIndex, historyItem] of (tab.roomHistory ?? []).entries()) {
      const room = historyItem.room
      if (!room.id || room.id === tab.kbId || room.id === tab.currentRoomId || seenRoomIds.has(room.id)) {
        continue
      }
      seenRoomIds.add(room.id)
      items.push({
        id: `history:${room.id}`,
        label: room.name,
        kind: 'history',
        historyIndex,
      })
    }

    if (tab.currentRoomId !== tab.kbId) {
      items.push({
        id: `current:${tab.currentRoomId}`,
        label: tab.currentRoomName || tab.currentRoomId,
        kind: 'current',
      })
    }

    return items
  }, [tab])

  const navigateToRoot = useCallback(async () => {
    logAction('房间:返回根级', 'Breadcrumb', {
      source: 'breadcrumb-root',
      tabId,
    })
    await graph.navigateToRoot()
  }, [tabId, graph])

  const navigateToHistory = useCallback(async (item: BreadcrumbItem) => {
    if (item.historyIndex == null) return
    logAction('房间:导航', 'Breadcrumb', {
      historyIndex: item.historyIndex,
      roomName: item.label,
      roomId: item.id,
      source: 'breadcrumb-history',
      tabId,
    })
    await graph.navigateToRoom(item.historyIndex)
  }, [tabId, graph])

  if (items.length === 0) return null

  return (
    <div
        id="breadcrumb"
        className="absolute top-3 left-3 z-[12] flex items-center gap-[5px] max-w-[min(560px,calc(100%-24px))] overflow-hidden whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] py-1.5 pl-3 pr-3.5 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl"
      >
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        if (item.kind === 'root') {
          return (
            <button
              key={item.id}
              className="max-w-[112px] truncate border-none bg-none p-0 text-xs font-medium text-[var(--color-accent)] transition-all hover:not(:disabled):underline disabled:cursor-default disabled:font-semibold disabled:text-[var(--color-primary)]"
              onClick={navigateToRoot}
              disabled={isLast}
              aria-current={isLast ? 'page' : undefined}
            >
              {item.label}
            </button>
          )
        }

        return (
          <span key={item.id} className="inline-flex items-center gap-[5px]">
            <span className="text-[10px] text-[var(--color-text-muted)] opacity-70">&gt;</span>
            {isLast ? (
              <span className="max-w-[180px] truncate font-semibold text-[var(--color-primary)]">{item.label}</span>
            ) : (
              <button
                className="max-w-[112px] truncate border-none bg-none p-0 text-xs font-medium text-[var(--color-accent)] transition-all hover:not(:disabled):underline disabled:cursor-default disabled:font-semibold disabled:text-[var(--color-primary)]"
                onClick={() => navigateToHistory(item)}
              >
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
})
