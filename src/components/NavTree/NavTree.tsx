/**
 * 导航树组件
 * 显示知识库列表，支持进入图谱
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useRoomStore } from '../../stores/roomStore'
import { useStorage } from '../../hooks/useStorage'
import { logger } from '../../core/logger'
import type { KBListItem } from '../../types'
import styles from './NavTree.module.css'

export default function NavTree() {
  const [kbs, setKbs] = useState<KBListItem[]>([])
  const showGraph = useAppStore((s) => s.showGraph)
  const setCurrentKB = useRoomStore((s) => s.setCurrentKB)
  const enterRoom = useRoomStore((s) => s.enterRoom)
  const storage = useStorage()

  useEffect(() => {
    const load = async () => {
      try {
        const list = await storage.listKBs()
        setKbs(list)
      } catch (e) {
        logger.catch('NavTree', 'listKBs', e)
      }
    }
    load()
  }, [storage])

  const handleKBOpen = (kb: KBListItem) => {
    setCurrentKB(kb.path)
    enterRoom({ path: kb.path, kbPath: kb.path, name: kb.name })
    showGraph()
  }

  return (
    <div className={styles.navTree}>
      <div className={styles.header}>知识库</div>
      <div className={styles.list}>
        {kbs.length === 0 && (
          <div className={styles.empty}>暂无知识库</div>
        )}
        {kbs.map((kb) => (
          <div
            key={kb.path}
            className={styles.item}
            onClick={() => handleKBOpen(kb)}
            title={kb.path}
          >
            <span className={styles.icon}>◎</span>
            <span className={styles.name}>{kb.name}</span>
            {kb.childCount !== undefined && (
              <span className={styles.count}>{kb.childCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
