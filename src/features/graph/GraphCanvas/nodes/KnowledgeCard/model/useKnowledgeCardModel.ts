import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { KnowledgeNode } from '../../../../../../types'
import { resolveRoomChildRef } from '../../../../../../domain/graph/path-utils'
import { useGraphUiStore } from '../../../../../../stores/graphUiStore'
import { useGraphStoreApi } from '../../../../../../stores/graphStore'
import { useGraphContext } from '../../../../../../contexts/GraphContext'

export function useKnowledgeCardModel(id: string, data: KnowledgeNode['data'], selected: boolean, width?: number, height?: number, resizing?: boolean) {
  const storeApi = useGraphStoreApi()
  const graph = useGraphContext()
  
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
      cardPath
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
      selectNode: (e: React.PointerEvent) => {
        if (!selected) graph.selectNode(id, e.shiftKey)
      }
    },
    refs: {
      titleInputRef
    }
  }
}
