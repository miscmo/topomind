/**
 * 面包屑导航组件
 * 显示完整房间路径：全局 > 父房间 > ... > 当前房间
 * 历史房间可点击跳转，当前房间不可点击
 * 每个 KB tab 有独立的 room 历史状态，从 tabStore 读取。
 */
import { memo, useEffect, useState } from 'react'
import { tabStore } from '../../stores/tabStore'
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

  const [history, setHistory] = useState<RoomHistoryItem[]>([])
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [currentRoomName, setCurrentRoomName] = useState<string>('')

  // Load room state from tabStore for this tab
  const loadFromTabStore = () => {
    if (!tabId) return
    const tabState = tabStore.getState().getRoomStateFromTab(tabId)
    if (tabState) {
      setHistory(tabState.roomHistory)
      setCurrentPath(tabState.currentRoomPath)
      setCurrentRoomName(tabState.currentRoomName)
    }
  }

  useEffect(() => {
    loadFromTabStore()

    const unsub = tabStore.subscribe(() => {
      loadFromTabStore()
    })
    return unsub
  }, [tabId])

  // Hide breadcrumb when at KB top level (no drilling down, no history)
  if (!currentPath || history.length === 0) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      {/* 全局 */}
      <button
        className={styles.link}
        onClick={async () => {
          logAction('房间:返回', 'Breadcrumb', { source: 'breadcrumb-home' })
          await graph.navigateBack()
        }}
      >
        🏠 全局
      </button>

      {/* 历史房间（可点击） */}
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

      {/* 当前房间（不可点击） */}
      <span className={styles.chain}>
        <span className={styles.sep}>&gt;</span>
        <span className={styles.current}>{currentRoomName}</span>
      </span>
    </div>
  )
})
