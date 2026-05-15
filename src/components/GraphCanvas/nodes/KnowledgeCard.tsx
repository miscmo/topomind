/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo, useEffect, useMemo, useState, useCallback } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, type NodeDimensionChange } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import { useStorage } from '../../../core/storage'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import MarkdownViewer from '../../MarkdownViewer'
import styles from './KnowledgeCard.module.css'

const MARKDOWN_MIN_WIDTH = 160
const MARKDOWN_MIN_HEIGHT = 96

function KnowledgeCard({ id, data, selected, dragging, width, height }: NodeProps<KnowledgeNode>) {
  const storage = useStorage()
  const graph = useGraphContext()
  const [isPressed, setIsPressed] = useState(false)
  const nodeWidth = width ?? 120
  const nodeHeight = height ?? 52
  const shouldShowMarkdown = nodeWidth >= MARKDOWN_MIN_WIDTH && nodeHeight >= MARKDOWN_MIN_HEIGHT
  const visuallySelected = selected || isPressed
  const connectingSourceId = useGraphUiStore((state) => state.connectingSourceId)
  const connectingTargetId = useGraphUiStore((state) => state.connectingTargetId)
  const isConnectTarget = !!connectingSourceId && connectingTargetId === id
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

  const handleDrillDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // 触发图谱内的向下钻取导航
    graph.navigateToChildRoom?.(id, data.label)
  }, [id, data.label, graph])



  const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()

    // React Flow 的 onNodesChange 触发 dimensions 变化需要带上 updateStyle
    if (shouldShowMarkdown) {
      // 缩小 (Collapse)
      graph.onNodesChange([{
        id,
        type: 'dimensions',
        dimensions: { width: 120, height: 36 },
        updateStyle: true,
        resizing: false
      } as NodeDimensionChange])
    } else {
      // 展开 (Expand): 使用记录的展开尺寸，如果没有则使用默认最小展开尺寸
      const targetWidth = Math.max(data.expandedWidth || MARKDOWN_MIN_WIDTH, MARKDOWN_MIN_WIDTH)
      const targetHeight = Math.max(data.expandedHeight || MARKDOWN_MIN_HEIGHT, MARKDOWN_MIN_HEIGHT)
      graph.onNodesChange([{
        id,
        type: 'dimensions',
        dimensions: { width: targetWidth, height: targetHeight },
        updateStyle: true,
        resizing: false
      } as NodeDimensionChange])
    }
  }, [id, data.expandedWidth, data.expandedHeight, shouldShowMarkdown, graph])

  const hasContent = entry ? entry.content.trim().length > 0 : data.hasContent === true

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
        color="#3b82f6"
        handleClassName={styles.resizeHandle}
        lineClassName={styles.resizeLine}
      />

      <Handle type="target" position={Position.Left} className={styles.hiddenTargetHandle} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={styles.handle} />

      <div className={styles.content} style={{ pointerEvents: 'none' }}>
        {/* Header 层 */}
        <div className={styles.header}>
          {/* 左侧占位符，用来平衡右侧控件宽度，保证标题居中 */}
          <div className={styles.headerSpacer} style={{ width: !shouldShowMarkdown ? 'auto' : 0, flex: !shouldShowMarkdown ? 1 : 'none', pointerEvents: 'none' }}></div>

          <div className={styles.label} style={{ flex: shouldShowMarkdown ? 1 : '0 1 auto', textAlign: shouldShowMarkdown ? 'left' : 'center' }}>
            {data.label}
          </div>

          <div className={styles.controls} style={{ flex: !shouldShowMarkdown ? 1 : 'none', justifyContent: 'flex-end' }}>
            {hasContent && (
              <div className={styles.docIcon} title="包含文档内容">
                <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
              </div>
            )}
            {data.childCount !== undefined && data.childCount > 0 && (
              <div
                className={styles.childBadgeBtn}
                onClick={handleDrillDown}
                title={`点击进入包含 ${data.childCount} 个子节点的画布`}
              >
                {data.childCount}
              </div>
            )}
            {hasContent && (
              <div
                className={styles.collapseBtn}
                onClick={handleToggleCollapse}
                title={shouldShowMarkdown ? '收起卡片' : '展开卡片'}
              >
                {shouldShowMarkdown ? '−' : '+'}
              </div>
            )}
          </div>
        </div>

        {/* Body 层 */}
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
    </div>
  )
}

export default memo(KnowledgeCard)
