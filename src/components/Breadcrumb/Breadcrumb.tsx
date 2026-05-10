/**
 * 面包屑导航组件
 * 显示当前画布层级：知识库根 > 父节点 > ... > 当前节点
 */
import { memo, useCallback, useMemo } from 'react'
import { logAction } from '../../core/log-backend'
import { useGraphContext } from '../../contexts/GraphContext'
import { useTabStore } from '../../stores/tabStore'
import styles from './Breadcrumb.module.css'

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
    <div id="breadcrumb" className={styles.breadcrumb}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        if (item.kind === 'root') {
          return (
            <button
              key={item.id}
              className={styles.link}
              onClick={navigateToRoot}
              disabled={isLast}
              aria-current={isLast ? 'page' : undefined}
            >
              {item.label}
            </button>
          )
        }

        return (
          <span key={item.id} className={styles.chain}>
            <span className={styles.sep}>&gt;</span>
            {isLast ? (
              <span className={styles.current}>{item.label}</span>
            ) : (
              <button
                className={styles.link}
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
