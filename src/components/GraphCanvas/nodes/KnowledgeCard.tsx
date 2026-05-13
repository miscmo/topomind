/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import styles from './KnowledgeCard.module.css'

function KnowledgeCard({ data, selected, dragging }: NodeProps<KnowledgeNode>) {
  const hasUnsaved = data.hasUnsavedEdit

  return (
    <div
      className={[
        styles.node,
        selected ? styles.selected : '',
        data.hovered ? styles.hovered : '',
        data.connectTarget ? styles.connectTarget : '',
        hasUnsaved ? styles.unsaved : '',
        dragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      style={data.domainColor ? { borderColor: data.domainColor } : undefined}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <Handle type="source" position={Position.Right} className={styles.handle} />

      {/* 标签 */}
      <div className={styles.label}>{data.label}</div>

      {/* 子节点徽章 */}
      {data.childCount !== undefined && data.childCount > 0 && (
        <div className={styles.badge}>{data.childCount}</div>
      )}

      {/* 未保存指示器 */}
      {hasUnsaved && <div className={styles.unsavedDot} title="有未保存的编辑" />}
    </div>
  )
}

export default memo(KnowledgeCard)
