/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 * container: 有子节点的容器卡片（浅色背景、彩色边框）
 * leaf: 叶子卡片（深色填充、白色文字）
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode, KnowledgeNodeData } from '../types'
import styles from './KnowledgeCard.module.css'

function KnowledgeCard({ data, selected, dragging }: NodeProps<KnowledgeNode>) {
  const isContainer = data.nodeType === 'container'
  const hasUnsaved = data.hasUnsavedEdit

  return (
    <div
      className={[
        styles.node,
        isContainer ? styles.container : styles.leaf,
        selected ? styles.selected : '',
        data.searchMatch ? styles.searchMatch : '',
        data.hovered ? styles.hovered : '',
        data.connectTarget ? styles.connectTarget : '',
        hasUnsaved ? styles.unsaved : '',
        dragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      style={data.domainColor ? { borderColor: data.domainColor } : undefined}
    >
      {/* 轻量连接入口 */}
      <Handle type="target" position={Position.Left} className={styles.handleTarget} />
      <Handle type="source" position={Position.Right} className={styles.handleSource} />
      <div className={styles.connectHint} aria-hidden="true">
        <span className={styles.connectHintIcon}>＋</span>
      </div>

      {/* 标签 */}
      <div className={styles.label}>{data.label}</div>

      {/* 子节点徽章 */}
      {data.hasChildren && data.childCount !== undefined && data.childCount > 0 && (
        <div className={styles.badge}>{data.childCount}</div>
      )}

      {/* 未保存指示器 */}
      {hasUnsaved && <div className={styles.unsavedDot} title="有未保存的编辑" />}
    </div>
  )
}

export default memo(KnowledgeCard)
