import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { KnowledgeNode } from '../../../../../../types'
import { resolveRoomChildRef } from '../../../../../../domain/graph/path-utils'
import { useGraphUiStore } from '../../../../../../stores/graphUiStore'
import { useGraphStore, useGraphStoreApi } from '../../../../../../stores/graphStore'
import { useGraphContext } from '../../../../../../contexts/GraphContext'
import { calculateKnowledgeCardAutoSize, getKnowledgeCardAccessoryWidth } from './autoSize'

export function useKnowledgeCardModel(id: string, data: KnowledgeNode['data'], selected: boolean, width?: number, height?: number, resizing?: boolean) {
  const storeApi = useGraphStoreApi()
  const graph = useGraphContext()
  const selectedNodeCount = useGraphStore((state) => state.nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0))
  
  const [isHovered, setIsHovered] = useState<boolean>(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label)
  const [resizePreviewSize, setResizePreviewSize] = useState<{ width: number; height: number } | null>(null)
  
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleSavingRef = useRef(false)
  const resizeHideTimerRef = useRef<number | null>(null)
  
  const defaultNodeStyle = useGraphUiStore((state: any) => state.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((state: any) => state.defaultNodeSize)
  const nodeSizeLimits = useGraphUiStore((state: any) => state.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((state: any) => state.nodeBadgeSize)
  
  const isConnectTarget = useGraphUiStore((state: any) => !!state.connectingSourceId && state.connectingTargetId === id)
  const isConnectSource = useGraphUiStore((state: any) => state.connectingSourceId === id)
  
  const nodeWidth = width ?? defaultNodeSize.width
  const nodeHeight = height ?? defaultNodeSize.height
  const resizeDisplaySize = resizePreviewSize ?? { width: nodeWidth, height: nodeHeight }
  const showResizeLabel = resizing === true || resizePreviewSize !== null
  const resizeLabel = `${Math.round(resizeDisplaySize.width)} × ${Math.round(resizeDisplaySize.height)}`
  
  const visuallySelected = selected
  const visuallyHovered = isHovered || data.hovered === true
  const showHoverControls = visuallyHovered || visuallySelected || isConnectTarget || isConnectSource
  const contentInteractionsEnabled = selected
  const nodeStyle = { ...defaultNodeStyle, ...(data.nodeStyle ?? {}) }
  const widthMode = data.widthMode ?? 'auto'
  const heightMode = data.heightMode ?? 'auto'
  const autoSize = useMemo(() => calculateKnowledgeCardAutoSize(data.label, nodeStyle, data), [data, nodeStyle])
  const accessoryWidth = useMemo(() => getKnowledgeCardAccessoryWidth(data), [data])
  
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
    storeApi.getState().updateNode(id, (node: any) => ({
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
    graph.navigateToChildRoom?.(cardPath, data.label)
  }, [cardPath, data.label, graph])

  const confirmTitleEdit = useCallback(async (options?: { restoreFocus?: boolean }) => {
    if (titleSavingRef.current) return
    titleSavingRef.current = true
    const nextTitle = titleDraft.trim()
    
    const canvas = titleInputRef.current?.closest('[data-shortcut-scope="canvas"]') as HTMLElement | null

    setTitleEditing(false)
    
    if (canvas && options?.restoreFocus !== false) {
      requestAnimationFrame(() => canvas.focus())
    }

    if (!nextTitle || nextTitle === data.label) {
      setTitleDraft(data.label)
      titleSavingRef.current = false
      return
    }
    const renamed = await graph.renameNode(id, nextTitle)
    if (!renamed) setTitleDraft(data.label)
    titleSavingRef.current = false
  }, [data.label, graph, id, titleDraft])

  const cancelTitleEdit = useCallback((options?: { restoreFocus?: boolean }) => {
    const canvas = titleInputRef.current?.closest('[data-shortcut-scope="canvas"]') as HTMLElement | null

    setTitleDraft(data.label)
    setTitleEditing(false)

    if (canvas && options?.restoreFocus !== false) {
      requestAnimationFrame(() => canvas.focus())
    }
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

  useEffect(() => {
    if (titleEditing) return
    if (widthMode !== 'auto' && heightMode !== 'auto') return

    const nextWidth = widthMode === 'auto' ? autoSize.width : nodeWidth
    const nextHeight = heightMode === 'auto' ? autoSize.height : nodeHeight
    if (Math.abs(nextWidth - nodeWidth) < 1 && Math.abs(nextHeight - nodeHeight) < 1) return

    graph.onNodesChange([{
      id,
      type: 'dimensions',
      dimensions: { width: nextWidth, height: nextHeight },
      resizing: false,
      origin: 'auto-size',
    } as any])
  }, [autoSize.height, autoSize.width, graph, heightMode, id, nodeHeight, nodeWidth, titleEditing, widthMode])

  const setSizingMode = useCallback(async (nextAuto: boolean) => {
    await graph.updateNodeSizingMode(id, nextAuto
      ? { widthMode: 'auto', heightMode: 'auto' }
      : { widthMode: 'manual', heightMode: 'manual' })
  }, [graph, id])

  const updateHeaderBackgroundColor = useCallback(async (value: string) => {
    await graph.updateNodeStyle(id, { headerBackgroundColor: value })
  }, [graph, id])

  const updateHeaderFontSize = useCallback(async (value: number) => {
    await graph.updateNodeStyle(id, { headerFontSize: value })
  }, [graph, id])

  const toggleBold = useCallback(async () => {
    await graph.updateNodeStyle(id, { headerFontWeight: nodeStyle.headerFontWeight === 'bold' ? 'normal' : 'bold' })
  }, [graph, id, nodeStyle.headerFontWeight])

  const toggleItalic = useCallback(async () => {
    await graph.updateNodeStyle(id, { headerFontStyle: nodeStyle.headerFontStyle === 'italic' ? 'normal' : 'italic' })
  }, [graph, id, nodeStyle.headerFontStyle])

  const isFormatPainterActive = useGraphUiStore((state) => state.formatPainterStyle !== null)
  
  const toggleFormatPainter = useCallback(() => {
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    } else {
      uiStore.setFormatPainterStyle(nodeStyle)
    }
  }, [nodeStyle])

  return {
    state: {
      isHovered,
      titleEditing,
      titleDraft,
      showHoverControls,
      showResizeLabel,
      resizeLabel,
      visuallySelected,
      visuallyHovered,
      isConnectTarget,
      isConnectSource,
      contentInteractionsEnabled,
      nodeStyle,
      nodeWidth,
      nodeHeight,
      nodeSizeLimits,
      nodeBadgeSize,
      cardPath,
      widthMode,
      heightMode,
      showQuickToolbar: selected && selectedNodeCount === 1 && !titleEditing && !isFormatPainterActive,
      accessoryWidth,
      isFormatPainterActive,
    },
    actions: {
      setIsHovered,
      setTitleDraft,
      updateResizePreview,
      hideResizePreviewSoon,
      handleDrillDown,
      confirmTitleEdit,
      cancelTitleEdit,
      startTitleEdit,
      setSizingMode,
      updateHeaderBackgroundColor,
      updateHeaderFontSize,
      toggleBold,
      toggleItalic,
      toggleFormatPainter,
      selectNode: (e: React.PointerEvent) => {
        const uiStore = useGraphUiStore.getState()
        if (uiStore.formatPainterStyle !== null) {
          e.preventDefault()
          e.stopPropagation()
          
          // apply format painter style
          const { headerBackgroundColor, headerFontSize, headerFontWeight, headerFontStyle, headerColor, borderColor, borderWidth, borderRadius } = uiStore.formatPainterStyle
          const patch: any = {}
          if (headerBackgroundColor !== undefined) patch.headerBackgroundColor = headerBackgroundColor
          if (headerFontSize !== undefined) patch.headerFontSize = headerFontSize
          if (headerFontWeight !== undefined) patch.headerFontWeight = headerFontWeight
          if (headerFontStyle !== undefined) patch.headerFontStyle = headerFontStyle
          if (headerColor !== undefined) patch.headerColor = headerColor
          if (borderColor !== undefined) patch.borderColor = borderColor
          if (borderWidth !== undefined) patch.borderWidth = borderWidth
          if (borderRadius !== undefined) patch.borderRadius = borderRadius

          if (Object.keys(patch).length > 0) {
            void graph.updateNodeStyle(id, patch)
          }
          return
        }

        if (!selected) graph.selectNode(id, e.shiftKey)
      }
    },
    refs: {
      titleInputRef
    }
  }
}
