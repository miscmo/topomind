/**
 * 面包屑导航组件
 * 显示完整房间路径：全局 > 父房间 > ... > 当前房间
 * 历史房间可点击跳转，当前房间不可点击
 */
import { useRoomStore, roomStore } from '../../stores/roomStore'
import { useGraphContext } from '../../contexts/GraphContext'
import type { RoomHistoryItem } from '../../types'
import styles from './Breadcrumb.module.css'

export default function Breadcrumb() {
  const graph = useGraphContext()

  // Get full history chain
  const history = roomStore.getState().roomHistory
  const currentPath = roomStore.getState().currentRoomPath

  if (!currentPath) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      {/* 全局 */}
      <button
        className={styles.link}
        onClick={async () => {
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
        <span className={styles.current}>{roomStore.getState().currentRoomName}</span>
      </span>
    </div>
  )
}
