/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Handle, NodeResizer, Position, type NodeProps, type NodeDimensionChange } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import { useStorage } from '../../../core/storage'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { MarkdownPreview } from '../../MarkdownWorkspace/MarkdownPreview'
import { MarkdownWorkspace } from '../../MarkdownWorkspace/MarkdownWorkspace'
import styles from './KnowledgeCard.module.css'

const MARKDOWN_MIN_WIDTH = 160
const MARKDOWN_MIN_HEIGHT = 96
const COLLAPSED_NODE_WIDTH = 120
const COLLAPSED_NODE_HEIGHT = 36

interface KnowledgeCardProps extends NodeProps<KnowledgeNode> {
  resizing?: boolean
}

function KnowledgeCard({ id, data, selected, dragging, width, height, resizing }: KnowledgeCardProps) {
  const storage = useStorage()
  const storeApi = useGraphStoreApi()
  const graph = useGraphContext()
  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label)
  const [markdownEditing, setMarkdownEditing] = useState(false)
  const [markdownDraft, setMarkdownDraft] = useState('')
  const [resizePreviewSize, setResizePreviewSize] = useState<{ width: number; height: number } | null>(null)
  const [preview, setPreview] = useState<{ type: 'image'; src: string; title: string } | { type: 'html'; html: string; title: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null)
  const titleSavingRef = useRef(false)
  const markdownAutosaveTimerRef = useRef<number | null>(null)
  const resizeHideTimerRef = useRef<number | null>(null)
  const defaultNodeStyle = useGraphUiStore((state) => state.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((state) => state.defaultNodeSize)
  const nodeWidth = width ?? defaultNodeSize.width
  const nodeHeight = height ?? defaultNodeSize.height
  const resizeDisplaySize = resizePreviewSize ?? { width: nodeWidth, height: nodeHeight }
  const showResizeLabel = resizing === true || resizePreviewSize !== null
  const resizeLabel = `${Math.round(resizeDisplaySize.width)} × ${Math.round(resizeDisplaySize.height)}`
  const shouldShowMarkdown = nodeWidth >= MARKDOWN_MIN_WIDTH && nodeHeight >= MARKDOWN_MIN_HEIGHT
  const visuallySelected = selected || isPressed
  const isConnectTarget = useGraphUiStore((state) => !!state.connectingSourceId && state.connectingTargetId === id)
  const isConnectSource = useGraphUiStore((state) => state.connectingSourceId === id)
  const nodeSizeLimits = useGraphUiStore((state) => state.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((state) => state.nodeBadgeSize)
  const visuallyHovered = isHovered || data.hovered === true
  const showHoverControls = visuallyHovered || visuallySelected || isConnectTarget || isConnectSource
  const contentInteractionsEnabled = selected
  const nodeStyle = { ...defaultNodeStyle, ...(data.nodeStyle ?? {}) }
  const borderRadius = `${nodeStyle.borderRadius}px`
  const compactDocIconSize = Math.max(8, Math.round(nodeBadgeSize * 0.72))
  const badgeStyle: CSSProperties = {
    minWidth: nodeBadgeSize,
    height: nodeBadgeSize,
    borderRadius: nodeBadgeSize / 2,
    fontSize: Math.max(8, Math.round(nodeBadgeSize * 0.64)),
    lineHeight: 1,
  }
  const collapseButtonStyle: CSSProperties = {
    width: nodeBadgeSize,
    height: nodeBadgeSize,
    borderRadius: Math.max(2, Math.round(nodeBadgeSize * 0.28)),
    fontSize: Math.max(10, Math.round(nodeBadgeSize * 0.86)),
  }
  const docIconStyle: CSSProperties = {
    width: compactDocIconSize,
    height: nodeBadgeSize,
  }
  const docIconSvgStyle: CSSProperties = {
    width: compactDocIconSize,
    height: compactDocIconSize,
  }
  const headerStyle: CSSProperties = {
    width: '100%',
    borderTopLeftRadius: borderRadius,
    borderTopRightRadius: borderRadius,
    borderBottomLeftRadius: shouldShowMarkdown ? undefined : borderRadius,
    borderBottomRightRadius: shouldShowMarkdown ? undefined : borderRadius,
    ...(nodeStyle.headerBackgroundColor ? { backgroundColor: nodeStyle.headerBackgroundColor } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
  }
  const titleFieldStyle: CSSProperties = {
    flex: '1 1 auto',
    minWidth: 0,
    justifyContent: shouldShowMarkdown ? 'flex-start' : 'center',
    textAlign: shouldShowMarkdown ? 'left' : 'center',
    lineHeight: 1.3,
    ...(nodeStyle.headerFontSize ? { fontSize: nodeStyle.headerFontSize } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
    ...(nodeStyle.headerFontWeight ? { fontWeight: nodeStyle.headerFontWeight } : {}),
    ...(nodeStyle.headerFontStyle ? { fontStyle: nodeStyle.headerFontStyle } : {}),
  }
  const markdownStyle = {
    ...(nodeStyle.bodyFontSize ? { '--node-body-font-size': `${nodeStyle.bodyFontSize}px` } : {}),
    borderBottomLeftRadius: borderRadius,
    borderBottomRightRadius: borderRadius,
  } as CSSProperties
  const cardPath = useMemo(() => {
    const parent = typeof data.parent === 'string' ? data.parent : ''
    return resolveRoomChildRef(parent, id)
  }, [data.parent, id])
  const entry = useCardContentStore((state) => state.entries[cardPath])
  const detailEntry = useCardContentStore((state) => state.detailEntries[cardPath])
  const loadCardMarkdown = useCardContentStore((state) => state.loadCardMarkdown)

  useEffect(() => {
    if (!shouldShowMarkdown) return
    loadCardMarkdown(cardPath, storage)
  }, [cardPath, loadCardMarkdown, shouldShowMarkdown, storage])

  useEffect(() => {
    if (!titleEditing) setTitleDraft(data.label)
  }, [data.label, titleEditing])

  useEffect(() => {
    if (!data.titleEditRequested) return
    setTitleDraft(data.label)
    setTitleEditing(true)
    storeApi.getState().updateNode(id, (node) => ({
      ...node,
      data: {
        ...node.data,
        titleEditRequested: false,
      },
    }))
  }, [data.label, data.titleEditRequested, id, storeApi])

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
    return () => {
      if (markdownAutosaveTimerRef.current !== null) {
        window.clearTimeout(markdownAutosaveTimerRef.current)
      }
      if (resizeHideTimerRef.current !== null) {
        window.clearTimeout(resizeHideTimerRef.current)
      }
    }
  }, [])

  const clearResizeHideTimer = useCallback(() => {
    if (resizeHideTimerRef.current === null) return
    window.clearTimeout(resizeHideTimerRef.current)
    resizeHideTimerRef.current = null
  }, [])

  const updateResizePreview = useCallback((params: { width: number; height: number }) => {
    clearResizeHideTimer()
    setResizePreviewSize({ width: params.width, height: params.height })
  }, [clearResizeHideTimer])

  const hideResizePreviewSoon = useCallback((params: { width: number; height: number }) => {
    updateResizePreview(params)
    resizeHideTimerRef.current = window.setTimeout(() => {
      setResizePreviewSize(null)
      resizeHideTimerRef.current = null
    }, 500)
  }, [updateResizePreview])

  // 修复：React Flow 在仅点击未拖拽时可能不触发 onResizeEnd
  // 通过全局监听 pointerup 和 pointercancel，确保任何情况下松开鼠标都会触发尺寸预览的隐藏定时器
  useEffect(() => {
    const handlePointerUp = () => {
      setResizePreviewSize((current) => {
        if (current !== null && resizeHideTimerRef.current === null) {
          resizeHideTimerRef.current = window.setTimeout(() => {
            setResizePreviewSize(null)
            resizeHideTimerRef.current = null
          }, 500)
        }
        return current
      })
    }
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  const handleDrillDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 触发图谱内的向下钻取导航
    graph.navigateToChildRoom?.(id, data.label)
  }, [id, data.label, graph])

  const stopControlPointerDown = useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  const stopControlMouseDown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
  }, [])

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

  const persistMarkdownDraft = useCallback(async (nextContent: string) => {
    const savedContent = useCardContentStore.getState().entries[cardPath]?.content ?? ''
    if (nextContent === savedContent) return
    await storage.writeCardMarkdown(cardPath, nextContent)
    useCardContentStore.getState().setCardMarkdown(cardPath, nextContent)
    // 同步给 DetailPanel
    useCardContentStore.getState().setDetailMarkdown(`${cardPath}/_card.md`, nextContent)
    useDraftStore.getState().setDetailDraft(`${cardPath}/_card.md`, nextContent)
  }, [cardPath, storage])

  const saveMarkdownEdit = useCallback(async () => {
    if (markdownAutosaveTimerRef.current !== null) {
      window.clearTimeout(markdownAutosaveTimerRef.current)
      markdownAutosaveTimerRef.current = null
    }
    await persistMarkdownDraft(markdownDraft)
    setMarkdownEditing(false)
  }, [markdownDraft, persistMarkdownDraft])

  useEffect(() => {
    if (contentInteractionsEnabled) return
    setTitleEditing(false)
    setPreview(null)
    if (!markdownEditing) return
    if (markdownAutosaveTimerRef.current !== null) {
      window.clearTimeout(markdownAutosaveTimerRef.current)
      markdownAutosaveTimerRef.current = null
    }
    if (markdownDraft !== (entry?.content ?? '')) {
      void persistMarkdownDraft(markdownDraft)
    }
    setMarkdownEditing(false)
  }, [contentInteractionsEnabled, entry?.content, markdownDraft, markdownEditing, persistMarkdownDraft])

  useEffect(() => {
    if (!markdownEditing) return
    if (markdownDraft === (entry?.content ?? '')) return

    if (markdownAutosaveTimerRef.current !== null) {
      window.clearTimeout(markdownAutosaveTimerRef.current)
    }

    markdownAutosaveTimerRef.current = window.setTimeout(() => {
      markdownAutosaveTimerRef.current = null
      void persistMarkdownDraft(markdownDraft)
    }, 800)

    return () => {
      if (markdownAutosaveTimerRef.current !== null) {
        window.clearTimeout(markdownAutosaveTimerRef.current)
        markdownAutosaveTimerRef.current = null
      }
    }
  }, [entry?.content, markdownDraft, markdownEditing, persistMarkdownDraft])

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
        dimensions: {
          width: Math.min(nodeSizeLimits.maxWidth, Math.max(nodeSizeLimits.minWidth, data.collapsedWidth || COLLAPSED_NODE_WIDTH)),
          height: Math.min(nodeSizeLimits.maxHeight, Math.max(nodeSizeLimits.minHeight, data.collapsedHeight || COLLAPSED_NODE_HEIGHT)),
        },
        updateStyle: true,
        resizing: false
      } as NodeDimensionChange])
    } else {
      // 展开 (Expand): 使用记录的展开尺寸，如果没有则使用默认最小展开尺寸
      const targetWidth = Math.min(nodeSizeLimits.maxWidth, Math.max(data.expandedWidth || MARKDOWN_MIN_WIDTH, MARKDOWN_MIN_WIDTH, nodeSizeLimits.minWidth))
      const targetHeight = Math.min(nodeSizeLimits.maxHeight, Math.max(data.expandedHeight || MARKDOWN_MIN_HEIGHT, MARKDOWN_MIN_HEIGHT, nodeSizeLimits.minHeight))
      graph.onNodesChange([{
        id,
        type: 'dimensions',
        dimensions: { width: targetWidth, height: targetHeight },
        updateStyle: true,
        resizing: false
      } as NodeDimensionChange])
    }
  }, [id, data.expandedWidth, data.expandedHeight, data.collapsedWidth, data.collapsedHeight, shouldShowMarkdown, graph, nodeSizeLimits.maxHeight, nodeSizeLimits.maxWidth, nodeSizeLimits.minHeight, nodeSizeLimits.minWidth])

  const hasCardContent = entry ? entry.content.trim().length > 0 : data.hasContent === true
  const hasDetail = detailEntry ? detailEntry.content.trim().length > 0 : data.hasDetail === true
  const hasChildBadge = data.childCount !== undefined && data.childCount > 0

  return (
    <div
      onPointerEnter={() => setIsHovered(true)}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerLeave={() => {
        setIsHovered(false)
        setIsPressed(false)
      }}
      onPointerCancel={() => setIsPressed(false)}
      className={[
        styles.node,
        shouldShowMarkdown ? styles.hasMarkdown : '',
        shouldShowMarkdown ? 'nowheel' : '',
        visuallySelected ? styles.selected : '',
        visuallyHovered ? styles.hovered : '',
        isConnectTarget ? styles.connectTarget : '',
        dragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      style={{
        borderColor: visuallySelected ? undefined : data.domainColor ?? nodeStyle.borderColor,
        borderWidth: nodeStyle.borderWidth,
        borderRadius,
        width: width ?? defaultNodeSize.width,
        height: height ?? defaultNodeSize.height,
      }}
    >
      <NodeResizer
        isVisible={showHoverControls}
        minWidth={nodeSizeLimits.minWidth}
        minHeight={nodeSizeLimits.minHeight}
        maxWidth={nodeSizeLimits.maxWidth}
        maxHeight={nodeSizeLimits.maxHeight}
        handleClassName={styles.resizeHandle}
        lineClassName={styles.resizeLine}
        onResizeStart={(_, params) => updateResizePreview(params)}
        onResize={(_, params) => updateResizePreview(params)}
        onResizeEnd={(_, params) => hideResizePreviewSoon(params)}
      />

      {showResizeLabel && (
        <div className={styles.resizeLabel}>
          {resizeLabel}
        </div>
      )}

      <Handle type="target" position={Position.Left} className={styles.hiddenTargetHandle} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={styles.handle} />

      <div className={styles.content} style={{ pointerEvents: 'none', borderRadius }}>
        {/* Header 层 */}
        <div className={styles.header} style={headerStyle}>
          {/* 左侧占位符，用来平衡右侧控件宽度，保证标题居中 */}
          <div className={styles.headerSpacer} style={{ flex: '0 0 0', width: 0, pointerEvents: 'none' }}></div>

          <div
            className={`${styles.titleField} ${titleEditing ? styles.titleFieldEditing : ''}`}
            style={titleFieldStyle}
          >
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
              />
            ) : (
              <div
                className={styles.label}
                onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
                title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              >
                {data.label}
              </div>
            )}
          </div>

          <div className={styles.controls} style={{ flex: '0 0 auto', justifyContent: 'flex-end' }}>
            {hasDetail && (
              <div className={styles.docIcon} title="包含详情" style={docIconStyle}>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={docIconSvgStyle}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
              </div>
            )}
            {hasChildBadge && (
              <div
                className={`${styles.childBadgeBtn} nodrag nowheel`}
                onClick={handleDrillDown}
                onPointerDown={stopControlPointerDown}
                onMouseDown={stopControlMouseDown}
                title={`点击进入包含 ${data.childCount} 个子节点的画布`}
                style={badgeStyle}
              >
                {data.childCount}
              </div>
            )}
            {hasCardContent && (
              <div
                className={styles.collapseBtn}
                onClick={handleToggleCollapse}
                title={shouldShowMarkdown ? '收起卡片' : '展开卡片'}
                style={collapseButtonStyle}
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
            style={markdownStyle}
          >
            {entry?.loading ? (
              <div className={styles.muted}>加载中...</div>
            ) : markdownEditing && contentInteractionsEnabled ? (
              <div 
                className={styles.markdownEditorWorkspace} 
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
                style={{ height: '100%', width: '100%' }}
              >
                <MarkdownWorkspace
                  value={markdownDraft}
                  savedValue={entry?.content ?? ''}
                  onChange={setMarkdownDraft}
                  onSave={saveMarkdownEdit}
                  documentType="card"
                  attachmentCardPath={cardPath}
                  placeholder="输入卡片 Markdown..."
                />
              </div>
            ) : entry?.content ? (
              <MarkdownPreview content={entry.content} compact className="markdownBody" attachmentCardPath={cardPath} />
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
