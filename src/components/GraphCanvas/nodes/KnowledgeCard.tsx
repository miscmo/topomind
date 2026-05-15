/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import { useStorage } from '../../../core/storage'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import MarkdownViewer from '../../MarkdownViewer'
import styles from './KnowledgeCard.module.css'

const MARKDOWN_MIN_WIDTH = 160
const MARKDOWN_MIN_HEIGHT = 96

function KnowledgeCard({ id, data, selected, dragging, width, height }: NodeProps<KnowledgeNode>) {
  const storage = useStorage()
  const [isPressed, setIsPressed] = useState(false)
  const nodeWidth = width ?? 120
  const nodeHeight = height ?? 52
  const shouldShowMarkdown = nodeWidth >= MARKDOWN_MIN_WIDTH && nodeHeight >= MARKDOWN_MIN_HEIGHT
  const visuallySelected = selected || isPressed
  const connectingSourceId = useGraphUiStore((state) => state.connectingSourceId)
  const isConnectTarget = !!connectingSourceId && connectingSourceId !== id
  const cardPath = useMemo(() => {
    const parent = typeof data.parent === 'string' ? data.parent : ''
    return resolveRoomChildRef(parent, id)
  }, [data.parent, id])
  const entry = useCardContentStore((state) => state.entries[cardPath])
  const loadCardMarkdown = useCardContentStore((state) => state.loadCardMarkdown)

  useEffect(() => {
    if (!shouldShowMarkdown) return
    loadCardMarkdown(cardPath, storage)
  }, [cardPath, loadCardMarkdown, shouldShowMarkdown, storage])

  return (
    <div
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerLeave={() => setIsPressed(false)}
      onPointerCancel={() => setIsPressed(false)}
      className={[
        styles.node,
        shouldShowMarkdown ? styles.hasMarkdown : '',
        shouldShowMarkdown ? 'nowheel' : '',
        visuallySelected ? styles.selected : '',
        data.hovered ? styles.hovered : '',
        isConnectTarget ? styles.connectTarget : '',
        dragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      style={{
        borderColor: visuallySelected ? undefined : data.domainColor,
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
      <div className={styles.content}>
        <div className={styles.label}>{data.label}</div>
        {shouldShowMarkdown && (
          <div className={`${styles.markdown} nowheel`}>
            {entry?.loading ? (
              <div className={styles.muted}>加载中...</div>
            ) : entry?.content ? (
              <MarkdownViewer content={entry.content} compact attachmentCardPath={cardPath} />
            ) : null}
          </div>
        )}
      </div>

      {/* 子节点徽章 */}
      {data.childCount !== undefined && data.childCount > 0 && (
        <div className={styles.badge}>{data.childCount}</div>
      )}
    </div>
  )
}

export default memo(KnowledgeCard)
