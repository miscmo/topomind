/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label)
  const [markdownEditing, setMarkdownEditing] = useState(false)
  const [markdownDraft, setMarkdownDraft] = useState('')
  const [preview, setPreview] = useState<{ type: 'image'; src: string; title: string } | { type: 'html'; html: string; title: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null)
  const titleSavingRef = useRef(false)
  const nodeWidth = width ?? 120
  const nodeHeight = height ?? 52
  const shouldShowMarkdown = nodeWidth >= MARKDOWN_MIN_WIDTH && nodeHeight >= MARKDOWN_MIN_HEIGHT
  const visuallySelected = selected || isPressed
  const connectingSourceId = useGraphUiStore((state) => state.connectingSourceId)
  const connectingTargetId = useGraphUiStore((state) => state.connectingTargetId)
  const isConnectTarget = !!connectingSourceId && connectingTargetId === id
  const contentInteractionsEnabled = selected
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

  useEffect(() => {
    if (!titleEditing) setTitleDraft(data.label)
  }, [data.label, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [titleEditing])

  useEffect(() => {
    if (!markdownEditing) return
    markdownTextareaRef.current?.focus()
  }, [markdownEditing])

  useEffect(() => {
    if (!preview) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [preview])

  useEffect(() => {
    setMarkdownEditing(false)
    setPreview(null)
  }, [cardPath])

  useEffect(() => {
    if (contentInteractionsEnabled) return
    setTitleEditing(false)
    setMarkdownEditing(false)
    setPreview(null)
  }, [contentInteractionsEnabled])

  const handleDrillDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // 触发图谱内的向下钻取导航
    graph.navigateToChildRoom?.(id, data.label)
  }, [id, data.label, graph])

  const confirmTitleEdit = useCallback(async () => {
    if (titleSavingRef.current) return
    titleSavingRef.current = true
    const nextTitle = titleDraft.trim()
    setTitleEditing(false)
    if (!nextTitle || nextTitle === data.label) {
      setTitleDraft(data.label)
      titleSavingRef.current = false
      return
    }
    const renamed = await graph.renameNode(id, nextTitle)
    if (!renamed) setTitleDraft(data.label)
    titleSavingRef.current = false
  }, [data.label, graph, id, titleDraft])

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(data.label)
    setTitleEditing(false)
  }, [data.label])

  const startTitleEdit = useCallback((event: React.MouseEvent) => {
    if (!contentInteractionsEnabled) return
    event.preventDefault()
    event.stopPropagation()
    setTitleDraft(data.label)
    setTitleEditing(true)
  }, [contentInteractionsEnabled, data.label])

  const startMarkdownEdit = useCallback((event: React.MouseEvent) => {
    if (!contentInteractionsEnabled) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('img, svg, a, button, textarea')) return
    event.preventDefault()
    event.stopPropagation()
    setMarkdownDraft(entry?.content ?? '')
    setMarkdownEditing(true)
  }, [contentInteractionsEnabled, entry?.content])

  const cancelMarkdownEdit = useCallback(() => {
    setMarkdownDraft(entry?.content ?? '')
    setMarkdownEditing(false)
  }, [entry?.content])

  const saveMarkdownEdit = useCallback(async () => {
    await storage.writeCardMarkdown(cardPath, markdownDraft)
    useCardContentStore.getState().setCardMarkdown(cardPath, markdownDraft)
    setMarkdownEditing(false)
  }, [cardPath, markdownDraft, storage])

  const handleMarkdownClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!contentInteractionsEnabled) return
    const target = event.target instanceof Element ? event.target : null
    const image = target?.closest('img') as HTMLImageElement | null
    if (image?.src) {
      event.preventDefault()
      event.stopPropagation()
      setPreview({ type: 'image', src: image.src, title: image.alt || '图片预览' })
      return
    }

    const svg = target?.closest('svg') as SVGSVGElement | null
    if (svg) {
      event.preventDefault()
      event.stopPropagation()
      setPreview({ type: 'html', html: svg.outerHTML, title: '图表预览' })
    }
  }, [contentInteractionsEnabled])



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

          {titleEditing ? (
            <input
              ref={titleInputRef}
              className={`${styles.titleInput} nodrag nowheel`}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={confirmTitleEdit}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') void confirmTitleEdit()
                if (event.key === 'Escape') cancelTitleEdit()
              }}
              style={{ flex: shouldShowMarkdown ? 1 : '0 1 auto', textAlign: shouldShowMarkdown ? 'left' : 'center' }}
            />
          ) : (
            <div
              className={styles.label}
              onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
              title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              style={{ flex: shouldShowMarkdown ? 1 : '0 1 auto', textAlign: shouldShowMarkdown ? 'left' : 'center' }}
            >
              {data.label}
            </div>
          )}

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
          <div
            className={[
              styles.markdown,
              contentInteractionsEnabled ? styles.interactiveMarkdown : '',
              contentInteractionsEnabled ? 'nodrag' : '',
              contentInteractionsEnabled ? 'nowheel' : '',
            ].filter(Boolean).join(' ')}
            onClick={contentInteractionsEnabled ? handleMarkdownClick : undefined}
            onDoubleClick={contentInteractionsEnabled ? startMarkdownEdit : undefined}
            onPointerDown={contentInteractionsEnabled ? (event) => event.stopPropagation() : undefined}
          >
            {entry?.loading ? (
              <div className={styles.muted}>加载中...</div>
            ) : markdownEditing && contentInteractionsEnabled ? (
              <div className={styles.markdownEditor}>
                <textarea
                  ref={markdownTextareaRef}
                  className={styles.markdownTextarea}
                  value={markdownDraft}
                  onChange={(event) => setMarkdownDraft(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void saveMarkdownEdit()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelMarkdownEdit()
                    }
                  }}
                  placeholder="输入卡片 Markdown..."
                  spellCheck={false}
                />
                <div className={styles.markdownEditorBar}>
                  <span>Ctrl/Cmd + Enter 保存，Esc 取消</span>
                  <div className={styles.markdownEditorActions}>
                    <button type="button" onClick={cancelMarkdownEdit}>取消</button>
                    <button type="button" onClick={() => void saveMarkdownEdit()}>保存</button>
                  </div>
                </div>
              </div>
            ) : entry?.content ? (
              <MarkdownViewer content={entry.content} compact className="markdownBody" attachmentCardPath={cardPath} />
            ) : null}
          </div>
        )}
      </div>
      {preview && createPortal(
        <div className={styles.previewOverlay} onClick={() => setPreview(null)}>
          <div className={styles.previewPanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.previewHeader}>
              <span>{preview.title}</span>
              <button type="button" onClick={() => setPreview(null)}>×</button>
            </div>
            <div className={styles.previewBody}>
              {preview.type === 'image' ? (
                <img src={preview.src} alt={preview.title} />
              ) : (
                <div className={styles.previewSvg} dangerouslySetInnerHTML={{ __html: preview.html }} />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default memo(KnowledgeCard)
