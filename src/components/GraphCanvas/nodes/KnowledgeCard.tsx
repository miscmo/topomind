/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard.tsx
 */
import { memo, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { cn } from '@/lib/utils'

interface KnowledgeCardProps extends NodeProps<KnowledgeNode> {
  resizing?: boolean
}

function KnowledgeCard({ id, data, selected, dragging, width, height, resizing }: KnowledgeCardProps) {
  const storeApi = useGraphStoreApi()
  const graph = useGraphContext()
  const [isHovered, setIsHovered] = useState<boolean>(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label)
  const [resizePreviewSize, setResizePreviewSize] = useState<{ width: number; height: number } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleSavingRef = useRef(false)
  const resizeHideTimerRef = useRef<number | null>(null)
  const defaultNodeStyle = useGraphUiStore((state) => state.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((state) => state.defaultNodeSize)
  const nodeWidth = width ?? defaultNodeSize.width
  const nodeHeight = height ?? defaultNodeSize.height
  const resizeDisplaySize = resizePreviewSize ?? { width: nodeWidth, height: nodeHeight }
  const showResizeLabel = resizing === true || resizePreviewSize !== null
  const resizeLabel = `${Math.round(resizeDisplaySize.width)} × ${Math.round(resizeDisplaySize.height)}`
  const visuallySelected = selected
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
    height: '100%',
    borderRadius,
    ...(nodeStyle.headerBackgroundColor ? { backgroundColor: nodeStyle.headerBackgroundColor } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
  }
  const titleFieldStyle: CSSProperties = {
    flex: '0 1 auto',
    minWidth: 0,
    justifyContent: 'center',
    textAlign: 'center',
    lineHeight: 1.3,
    ...(nodeStyle.headerFontSize ? { fontSize: nodeStyle.headerFontSize } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
    ...(nodeStyle.headerFontWeight ? { fontWeight: nodeStyle.headerFontWeight } : {}),
    ...(nodeStyle.headerFontStyle ? { fontStyle: nodeStyle.headerFontStyle } : {}),
  }
  
  const cardPath = useMemo(() => {
    const parent = typeof data.parent === 'string' ? data.parent : ''
    return resolveRoomChildRef(parent, id)
  }, [data.parent, id])

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
    return () => {
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

  useEffect(() => {
    if (contentInteractionsEnabled) return
    setTitleEditing(false)
  }, [contentInteractionsEnabled])

  const hasChildBadge = data.childCount !== undefined && data.childCount > 0
  const hasDetail = data.hasDetail === true

  return (
    <div
      onPointerEnter={() => setIsHovered(true)}
      onPointerDownCapture={(e) => {
        if (!selected) {
          graph.selectNode(id, e.shiftKey)
        }
      }}
      onPointerLeave={() => {
        setIsHovered(false)
      }}
      className={cn(
        "relative flex items-stretch justify-stretch overflow-visible rounded-lg border bg-surface shadow-sm transition-opacity duration-75 active:border-accent active:shadow-[0_0_0_1px_var(--color-accent-soft)] w-full h-full box-border",
        selected && "border-accent shadow-[0_0_0_1px_var(--color-accent)] z-10",
        isConnectTarget && "border-2 border-success shadow-[0_0_0_1px_var(--color-success)] !border-success z-10",
        visuallyHovered && !visuallySelected && !isConnectTarget && "border-border-strong",
        dragging && "opacity-90"
      )}
      style={{
        cursor: dragging ? 'grabbing' : 'default',
        borderColor: visuallySelected ? undefined : data.domainColor ?? nodeStyle.borderColor,
        borderWidth: isConnectTarget ? 2 : nodeStyle.borderWidth,
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
        handleClassName="w-2 h-2 bg-surface border-[1.5px] border-accent rounded-[2px] shadow-sm z-30"
        lineClassName="border-transparent z-20"
        onResizeStart={(_, params) => updateResizePreview(params)}
        onResize={(_, params) => updateResizePreview(params)}
        onResizeEnd={(_, params) => hideResizePreviewSoon(params)}
      />

      {showResizeLabel && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-2 py-0.5 text-xs text-muted-foreground shadow-sm pointer-events-none whitespace-nowrap z-50">
          {resizeLabel}
        </div>
      )}

      <Handle type="target" position={Position.Left} className="w-0 h-0 border-none opacity-0" isConnectable={false} />
      <Handle 
        type="source" 
        position={Position.Right} 
        className={cn(
          "w-5 h-5 border-[1.5px] border-accent rounded-full shadow-[0_2px_4px_var(--color-accent-soft)] !-right-[18px] z-30 flex items-center justify-center transition-all duration-75 cursor-crosshair",
          showHoverControls ? "opacity-100" : "opacity-0 pointer-events-none",
          isConnectSource
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] dark:text-white ring-2 ring-[var(--color-accent-soft)]"
            : "bg-[var(--color-surface)] text-black dark:bg-[var(--color-surface)] dark:text-white hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] dark:hover:text-white"
        )}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </Handle>

      <div className="flex flex-1 flex-col items-stretch justify-start overflow-hidden pointer-events-none min-w-0 min-h-0" style={{ borderRadius }}>
        {/* Header 层 */}
        <div className="flex w-full items-center justify-between shrink-0" style={headerStyle}>
          {/* 左侧占位符，用来平衡右侧控件宽度，保证标题居中 */}
          <div style={{ flex: '1 1 0', pointerEvents: 'none' }}></div>

          <div
            className={cn("flex items-center min-w-0 min-h-[calc(1.3em+4px)] py-[1px] rounded-md transition-colors duration-75", titleEditing && "bg-surface/20 shadow-[inset_0_0_0_1px_var(--color-border-light)] focus-within:bg-surface/40 focus-within:shadow-[inset_0_0_0_1px_var(--color-border),0_0_0_2px_var(--color-accent-soft)]")}
            style={titleFieldStyle}
          >
            {titleEditing ? (
              <input
                ref={titleInputRef}
                className="w-full min-w-0 min-h-[calc(1.3em+4px)] px-[3px] py-[1px] border-none rounded-none bg-transparent text-inherit font-inherit text-inherit leading-inherit outline-none box-border pointer-events-auto shadow-none caret-current transition-colors duration-75 nodrag nowheel"
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
                className="block w-full font-inherit text-inherit leading-inherit break-normal whitespace-nowrap overflow-hidden text-ellipsis pointer-events-auto select-none"
                onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
                title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              >
                {data.label}
              </div>
            )}
          </div>

          <div className="relative z-50 flex items-center justify-end gap-[2px] shrink-0 ml-0 pr-[6px] pointer-events-auto" style={{ flex: '1 1 0' }}>
            {hasDetail && (
              <div className="flex items-center justify-center shrink-0 text-muted-foreground leading-none" title="包含详情" style={docIconStyle}>
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
                className="flex items-center justify-center bg-accent text-accent-foreground cursor-pointer transition-colors duration-75 hover:bg-accent-hover font-bold select-none nodrag nowheel"
                onClick={handleDrillDown}
                onPointerDown={stopControlPointerDown}
                onMouseDown={stopControlMouseDown}
                title={`点击进入包含 ${data.childCount} 个子节点的画布`}
                style={badgeStyle}
              >
                {data.childCount}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(KnowledgeCard)
