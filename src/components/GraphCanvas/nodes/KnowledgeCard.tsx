/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import styles from './KnowledgeCard.module.css'

function KnowledgeCard({ data, selected, dragging, width, height }: NodeProps<KnowledgeNode>) {
  return (
    <div
      className={[
        styles.node,
        selected ? styles.selected : '',
        data.hovered ? styles.hovered : '',
        data.connectTarget ? styles.connectTarget : '',
        dragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      style={{
        borderColor: selected ? undefined : data.domainColor,
        width: width ?? undefined,
        height: height ?? undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={52}
        maxWidth={640}
        maxHeight={480}
        color="#3498db"
        handleClassName={styles.resizeHandle}
        lineClassName={styles.resizeLine}
      />

      <Handle type="target" position={Position.Left} className={styles.handle} />
      <Handle type="source" position={Position.Right} className={styles.handle} />

      {/* 标签 */}
      <div className={styles.label}>{data.label}</div>

      {/* 子节点徽章 */}
      {data.childCount !== undefined && data.childCount > 0 && (
        <div className={styles.badge}>{data.childCount}</div>
      )}
    </div>
  )
}

export default memo(KnowledgeCard)
