import { useState } from 'react'
import { logAction } from '../../core/log-backend'
import type { KBItem } from './useHomeKnowledgeBases'
import styles from './HomePage.module.css'

interface KnowledgeBaseGridProps {
  kbs: KBItem[]
  onOpenKB: (kb: KBItem) => void
  onCreateKB: () => void
  onImportKB: () => void
  onOpenSettings: (kb: KBItem) => void
}

export function KnowledgeBaseGrid(props: KnowledgeBaseGridProps) {
  const { kbs, onOpenKB, onCreateKB, onImportKB, onOpenSettings } = props

  return (
    <div className={styles.grid}>
      {kbs.map((kb) => (
        <div
          key={kb.name}
          className={styles.card}
          onClick={() => {
            logAction('HomePage:点击知识库卡片', 'HomePage', { kbInfo: kb })
            onOpenKB(kb)
          }}
        >
          <div className={styles.cardImage}>
            {kb.coverUrl ? (
              <img src={kb.coverUrl} alt={kb.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span className={styles.cardImageIcon}>📚</span>
            )}
            <button
              className={styles.settingsBtn}
              onClick={(e) => {
                e.stopPropagation()
                onOpenSettings(kb)
              }}
              title="知识库设置"
            >
              ⚙️
            </button>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.cardTitle}>
              <span>{kb.name}</span>
            </div>
            <div className={styles.cardMeta}>
              <div className={styles.cardMetaRow}>
                <span>
                  📊 {kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className={styles.cardAdd} onClick={onCreateKB}>
        <div className={styles.cardAddIcon}>＋</div>
        <div className={styles.cardAddText}>新建知识库</div>
      </div>

      <div className={styles.cardAdd} onClick={onImportKB}>
        <div className={styles.cardAddIcon}>📥</div>
        <div className={styles.cardAddText}>导入知识库</div>
      </div>
    </div>
  )
}
