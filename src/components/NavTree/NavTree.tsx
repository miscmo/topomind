/**
 * 导航树组件
 * 显示知识库列表，支持进入图谱
 */
import { useEffect, useState, memo } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useRoomStore } from '../../stores/roomStore'
import { useStorage } from '../../hooks/useStorage'
import { usePromptStore } from '../../stores/promptStore'
import { logAction } from '../../core/log-backend'
import { logger } from '../../core/logger'
import type { KBListItem } from '../../types'
import { DOMAIN_COLORS } from '../../types'
import styles from './NavTree.module.css'

export default memo(function NavTree() {
  const [kbs, setKbs] = useState<KBListItem[]>([])
  const showGraph = useAppStore((s) => s.showGraph)
  const setCurrentKB = useRoomStore((s) => s.setCurrentKB)
  const enterRoom = useRoomStore((s) => s.enterRoom)
  const triggerKBRefresh = useAppStore((s) => s.triggerKBRefresh)
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
  }, [storage, triggerKBRefresh])

  const handleKBOpen = (kb: KBListItem) => {
    setCurrentKB(kb.path)
    enterRoom({ path: kb.path, kbPath: kb.path, name: kb.name })
    showGraph()
  }

  const prompt = usePromptStore((s) => s.open)

  const handleNewCard = async () => {
    const name = await prompt({ title: '新建知识库', placeholder: '知识库名称' })
    if (!name?.trim()) return
    logAction('知识库:创建', 'NavTree', { kbName: name.trim() })
    try {
      await storage.createKB(name.trim())
      const list = await storage.listKBs()
      setKbs(list)
      triggerKBRefresh()
    } catch (e) {
      logger.catch('NavTree', 'createKB', e)
    }
  }

  return (
    <div className={styles.navTree}>
      <div className={styles.header}>知识库</div>
      <div className={styles.list}>
        {kbs.length === 0 && (
          <div className={styles.empty}>暂无知识库</div>
        )}
        {kbs.map((kb, i) => (
          <div
            key={kb.path}
            className={styles.item}
            onClick={() => handleKBOpen(kb)}
            title={kb.path}
          >
            <span
              className={styles.colorDot}
              style={{ background: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }}
            />
            <span className={styles.icon}>◎</span>
            <span className={styles.name}>{kb.name}</span>
            {kb.childCount !== undefined && (
              <span className={styles.count}>{kb.childCount}</span>
            )}
          </div>
        ))}

        {/* 新建知识库按钮 */}
        <div
          className={styles.addButton}
          onClick={handleNewCard}
          title="新建知识库"
        >
          <span className={styles.addIcon}>+</span>
          <span className={styles.addText}>新建卡片</span>
        </div>
      </div>
    </div>
  )
})
