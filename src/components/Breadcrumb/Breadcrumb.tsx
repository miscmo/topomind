/**
 * 面包屑导航组件
 * 显示当前房间路径，支持点击返回
 */
import { useRoomStore } from '../../stores/roomStore'
import { useGraphContext } from '../../contexts/GraphContext'
import styles from './Breadcrumb.module.css'

export default function Breadcrumb() {
  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const goBack = useRoomStore((s) => s.goBack)
  const graph = useGraphContext()

  if (!currentRoomPath) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      <button
        className={styles.rootLink}
        onClick={async () => {
          await graph.navigateBack()
        }}
      >
        全局
      </button>

      <span className={styles.sep}>&gt;</span>
      <span className={styles.current}>{currentRoomName}</span>
    </div>
  )
}
