/**
 * 面包屑导航组件
 * 显示当前画布层级：知识库根 > 父节点 > ... > 当前节点
 */
import { memo, useCallback, useMemo } from 'react'
import { logAction } from '../../core/log-backend'
import { useGraphContext } from '../../contexts/GraphContext'
import { useTabStore } from '../../stores/tabStore'

interface BreadcrumbProps {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId: string
}

interface BreadcrumbItem {
  id: string
  label: string
  path: string
  kind: 'root' | 'history' | 'current'
  historyIndex?: number
}

export default memo(function Breadcrumb({ tabId }: BreadcrumbProps) {
  const graph = useGraphContext()
  const tab = useTabStore((s) => s.getTabById(tabId))

  const items = useMemo<BreadcrumbItem[]>(() => {
    if (!tab || tab.type !== 'kb' || !tab.kbPath || !tab.currentRoomPath) return []

    const items: BreadcrumbItem[] = [
      {
        id: `root:${tab.kbPath}`,
        label: tab.label || '知识库',
        path: tab.kbPath,
        kind: 'root',
      },
    ]

    const seenPaths = new Set<string>([tab.kbPath])
    const currentPath = tab.currentRoomPath

    for (const [historyIndex, historyItem] of (tab.roomHistory ?? []).entries()) {
      const room = historyItem.room
      if (!room.path || room.path === tab.kbPath || room.path === currentPath || seenPaths.has(room.path)) {
        continue
      }
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
      roomPath: item.path,
      source: 'breadcrumb-history',
      tabId,
    })
    await graph.navigateToRoom(item.historyIndex)
  }, [tabId, graph])

  if (items.length === 0) return null

  return (
    <div id="breadcrumb" className="absolute top-3 left-1/2 -translate-x-1/2 z-[12] flex items-center gap-[5px] bg-[color-mix(in_srgb,var(--color-surface)_95%,transparent)] border border-[var(--color-border)] rounded-lg py-1.5 px-3.5 text-xs text-[var(--color-text-secondary)] max-w-[calc(100vw-240px)] overflow-hidden whitespace-nowrap shadow-[var(--shadow-md)]">
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        if (item.kind === 'root') {
          return (
            <button
              key={item.id}
              className="text-[var(--color-accent)] cursor-pointer font-medium bg-none border-none text-xs p-0 transition-all max-w-[120px] truncate hover:not(:disabled):underline disabled:text-[var(--color-primary)] disabled:font-semibold disabled:cursor-default"
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
            <span className="text-[var(--color-text-muted)]">&gt;</span>
            {isLast ? (
              <span className="text-[var(--color-primary)] font-semibold max-w-[120px] truncate">{item.label}</span>
            ) : (
              <button
                className="text-[var(--color-accent)] cursor-pointer font-medium bg-none border-none text-xs p-0 transition-all max-w-[120px] truncate hover:not(:disabled):underline disabled:text-[var(--color-primary)] disabled:font-semibold disabled:cursor-default"
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
