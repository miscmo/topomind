/**
 * 面包屑导航组件
 * 显示完整房间路径：知识库根 > 父房间 > ... > 当前房间
 * 历史房间可点击跳转，当前房间不可点击。
 */
import { memo } from 'react'
import { useRoomStore } from '../../stores/roomStore'
import { useTabStore } from '../../stores/tabStore'
import { useGraphContext } from '../../contexts/GraphContext'
import type { RoomHistoryItem } from '../../types'
import { logAction } from '../../core/log-backend'
import styles from './Breadcrumb.module.css'

interface BreadcrumbProps {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId?: string
}

export default memo(function Breadcrumb({ tabId }: BreadcrumbProps) {
  const graph = useGraphContext()

  const tab = useTabStore((s) => (tabId ? s.getTabById(tabId) : undefined))
  const roomHistory = useRoomStore((s) => s.roomHistory)
  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const currentKBPath = useRoomStore((s) => s.currentKBPath)

  const history = tabId ? (tab?.roomHistory ?? []) : roomHistory
  const activeRoomPath = tabId ? (tab?.currentRoomPath ?? null) : currentRoomPath
  const activeRoomName = tabId ? (tab?.currentRoomName ?? '') : currentRoomName
  const rootPath = tabId ? (tab?.kbPath ?? null) : currentKBPath
  const rootLabel = tabId ? (tab?.label ?? '知识库') : (rootPath ? '知识库' : '')
  const isAtRoot = Boolean(activeRoomPath && rootPath && activeRoomPath === rootPath)

  if (!rootLabel || !activeRoomPath) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      <button
        data-testid="breadcrumb-root"
        className={styles.link}
        onClick={async () => {
          logAction('房间:返回根级', 'Breadcrumb', { source: 'breadcrumb-root', rootLabel })
          await graph.navigateToRoot()
        }}
        disabled={isAtRoot}
        aria-current={isAtRoot ? 'page' : undefined}
      >
        {rootLabel}
      </button>

      {history.map((item: RoomHistoryItem, index: number) => (
        <span key={item.room.path} className={styles.chain}>
          <span className={styles.sep}>&gt;</span>
          <button
            className={styles.link}
            onClick={async () => {
              const roomName = item.room.name
              const roomPath = item.room.path
              logAction('房间:导航', 'Breadcrumb', { historyIndex: index, roomName, roomPath })
              await graph.navigateToRoom(index)
            }}
          >
            {item.room.name}
          </button>
        </span>
      ))}

      {!isAtRoot && (
        <span className={styles.chain}>
          <span className={styles.sep}>&gt;</span>
          <span className={styles.current}>{activeRoomName}</span>
        </span>
      )}
    </div>
  )
})
