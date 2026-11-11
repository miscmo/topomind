import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useReactFlow, type NodeChange } from '@xyflow/react'
import type { KnowledgeNode, KnowledgeNodeStyle } from '../../../../../../types'
import { resolveRoomChildRef } from '../../../../../../domain/graph/path-utils'
import { useGraphUiStore } from '../../../../../../stores/graphUiStore'
import { useActiveCanvasReadOnly } from '../../../../../../stores/canvasReadOnlyStore'
import { useGraphStore, useGraphStoreApi } from '../../../../../../stores/graphStore'
import { useGraphContext } from '../../../../../../contexts/GraphContext'
import { calculateKnowledgeCardAutoSize } from './autoSize'
import { describeKnowledgeCardTitle } from './titleDecorations'
import { useConfirmStore } from '../../../../../../shared/ui/ConfirmModal/confirmStore'
import { rememberViewportJump } from '../../../model/viewportReturnStore'

const activeResizePointerListeners = new Set<() => void>()
let resizePointerEventsAttached = false

function dispatchResizePointerRelease() {
  for (const listener of activeResizePointerListeners) {
    listener()
  }
}

function subscribeToResizePointerRelease(listener: () => void) {
  activeResizePointerListeners.add(listener)
  if (!resizePointerEventsAttached && typeof window !== 'undefined') {
    window.addEventListener('pointerup', dispatchResizePointerRelease)
    window.addEventListener('pointercancel', dispatchResizePointerRelease)
    resizePointerEventsAttached = true
  }

  return () => {
    activeResizePointerListeners.delete(listener)
    if (activeResizePointerListeners.size === 0 && resizePointerEventsAttached && typeof window !== 'undefined') {
      window.removeEventListener('pointerup', dispatchResizePointerRelease)
      window.removeEventListener('pointercancel', dispatchResizePointerRelease)
      resizePointerEventsAttached = false
    }
  }
}

export function useKnowledgeCardModel(id: string, data: KnowledgeNode['data'], selected: boolean, width?: number, height?: number, resizing?: boolean) {
  const storeApi = useGraphStoreApi()
  const graph = useGraphContext()
  const reactFlow = useReactFlow()
  // 【画布只读】远景下所有节点内编辑入口（标题 / 格式刷 / 快捷工具栏 / emoji）统一关掉；
  // 只订阅布尔，缩放过程中 hiddenNodeCount 变化不会让所有卡片重渲染。
  const canvasReadOnly = useActiveCanvasReadOnly()
  const showQuickToolbarForNode = useGraphStore((state) => (
    state.selectedNodeCount === 1 && state.selectedNodeId === id
  ))
  // 是否处于多选。只订阅布尔而不是 selectedNodeCount 数值本身：
  // 框选时 count 每帧都在变，订阅数值会让**所有**节点跟着重渲染；
  // 布尔只在跨过阈值（>1）时翻转一次，代价恒定。
  const isMultiSelected = useGraphStore((state) => state.selectedNodeCount > 1)
  // 缩放期间降级的开关（详见 KnowledgeCard 的 detailLevel）。
  // 两个订阅都是布尔：isViewportZooming 只在"开始/结束缩放"翻转，
  // isLargeRoom 只在节点增删时翻转，都不会每帧变化。
  const isViewportZooming = useGraphUiStore((s) => s.isViewportZooming)
  // 门槛刻意压得比较低：实测「视口里 280 个节点」就已经明显掉帧，而很多中等房间的
  // 节点总数恰好在 300 以下（此时整张图基本全在视口内），门槛设 300 会让它们完全
  // 享受不到降级。缩放是瞬态（松手即恢复），120 个节点以上开始降级是划算的取舍。
  const isLargeRoom = useGraphStore((state) => state.nodes.length > 120)
  const zoomDegradedDuringZoom = isViewportZooming && isLargeRoom
  
  const [isHovered, setIsHovered] = useState<boolean>(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [resizePreviewSize, setResizePreviewSize] = useState<{ width: number; height: number } | null>(null)
  
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleDraftRef = useRef(data.label)
  const titleSavingRef = useRef(false)
  const resizeHideTimerRef = useRef<number | null>(null)
  const isUpdatingDimensionsRef = useRef(false)
  
  const defaultNodeStyle = useGraphUiStore((state) => state.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((state) => state.defaultNodeSize)
  const nodeSizeLimits = useGraphUiStore((state) => state.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((state) => state.nodeBadgeSize)
  const isConnecting = useGraphUiStore((state) => state.connectingSourceId !== null)
  
  const isConnectTarget = useGraphUiStore((state) => !!state.connectingSourceId && state.connectingTargetId === id)
  const isConnectSource = useGraphUiStore((state) => state.connectingSourceId === id)
  
  const nodeWidth = width ?? defaultNodeSize.width
  const nodeHeight = height ?? defaultNodeSize.height
  const resizeDisplaySize = resizePreviewSize ?? { width: nodeWidth, height: nodeHeight }
  const showResizeLabel = resizing === true || resizePreviewSize !== null
  const resizeLabel = `${Math.round(resizeDisplaySize.width)} × ${Math.round(resizeDisplaySize.height)}`
  
  const visuallySelected = selected
  // 悬停纯本地：由组件内 isHovered 驱动。data.hovered 历史上预留给"外部高亮"，
  // 但全代码库没有任何写入者（已核实），属死字段，已从 KnowledgeNodeData 移除。
  const visuallyHovered = isHovered
  const showHoverControls = !isConnecting && (visuallyHovered || visuallySelected || isConnectTarget || isConnectSource)
  // 双击标题的入口：只读时置 false，已打开的 input 也会被下方 effect 立刻收起。
  const contentInteractionsEnabled = selected && !canvasReadOnly
  const nodeStyle = useMemo(
    () => ({ ...defaultNodeStyle, ...(data.nodeStyle ?? {}) }),
    [data.nodeStyle, defaultNodeStyle],
  )
  const widthMode = data.widthMode ?? 'auto'
  const heightMode = data.heightMode ?? 'auto'
  // 标题栏装饰的唯一事实来源：渲染侧与测量侧都消费同一份 decorations。
  // 这一步很廉价（只读几个字段 + 拼字符串），所以放心依赖整个 data；任何装饰写入
  // （含 linkedDocuments）都会重建描述，不会像旧实现那样因为「漏列依赖」而命中旧缓存。
  const decorations = useMemo(
    () => describeKnowledgeCardTitle(data, nodeStyle, nodeBadgeSize),
    [data, nodeStyle, nodeBadgeSize],
  )
  // 昂贵的 Canvas 文本测量只在 signature / label / 字体变化时重跑。
  // signature 由全部渲染输入序列化而来：以后新增装饰字段会自动进入签名，
  // 无需再手工往依赖数组里补字段（这正是关联文档链环丢失自适应能力的根因）。
  const autoSize = useMemo(
    () => calculateKnowledgeCardAutoSize(data.label, nodeStyle, decorations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.label, nodeStyle, decorations.signature],
  )
  const displayWidth = widthMode === 'auto' ? autoSize.width : nodeWidth
  const displayHeight = heightMode === 'auto' ? autoSize.height : nodeHeight
  
  const cardPath = useMemo(() => {
    const parent = typeof data.parent === 'string' ? data.parent : ''
    const cardRef = typeof data.cardRef === 'string' ? data.cardRef : id
    return resolveRoomChildRef(parent, cardRef)
  }, [data.parent, data.cardRef, id])

  useEffect(() => {
    if (!titleEditing) titleDraftRef.current = data.label
  }, [data.label, titleEditing])

  useEffect(() => {
    if (!data.titleEditRequested) return
    titleDraftRef.current = data.label
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
    if (!resizing) return

    const handlePointerRelease = () => {
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

    return subscribeToResizePointerRelease(handlePointerRelease)
  }, [resizing])

  const handleDrillDown = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    graph.navigateToChildRoom?.(cardPath, data.label)
  }, [cardPath, data.label, data.parent, data.cardRef, id, graph])

  const confirmTitleEdit = useCallback(async (options?: { restoreFocus?: boolean }) => {
    // 用户可能先双击进入编辑、再缩小镜头；input 的 onBlur / Enter 仍会走到这里，
    // 必须在写库前丢弃草稿（底层 renameNode 闸门也会拦，但要先把界面收回非编辑态）。
    if (canvasReadOnly) {
      titleDraftRef.current = data.label
      setTitleEditing(false)
      return
    }
    if (titleSavingRef.current) return
    titleSavingRef.current = true
    const nextTitle = (titleInputRef.current?.value ?? titleDraftRef.current).trim()
    
    const canvas = titleInputRef.current?.closest('[data-shortcut-scope="canvas"]') as HTMLElement | null

    setTitleEditing(false)

    if (!nextTitle || nextTitle === data.label) {
      titleDraftRef.current = data.label
      titleSavingRef.current = false
      if (canvas && options?.restoreFocus !== false) {
        requestAnimationFrame(() => canvas.focus())
      }
      return
    }

    const nodes = storeApi.getState().nodes
    const hasDuplicate = nodes.some(n => n.id !== id && n.data?.label?.trim() === nextTitle)

    if (hasDuplicate) {
      const confirm = useConfirmStore.getState().open
      
      try {
        const confirmed = await confirm({
          title: '同名节点确认',
          message: `当前画布中已存在名为「${nextTitle}」的节点，是否继续创建/重命名为该名称？`,
          confirmText: '继续创建/重命名',
          extraButtonText: '查看已存在节点',
          onExtraAction: () => {
            const duplicateNode = nodes.find(n => n.id !== id && n.data?.label?.trim() === nextTitle)
            if (duplicateNode) {
              graph.selectNode(duplicateNode.id)
              setTimeout(() => {
                const nodeRect = {
                  x: duplicateNode.position.x,
                  y: duplicateNode.position.y,
                  width: duplicateNode.width ?? 120,
                  height: duplicateNode.height ?? 52
                }
                const zoom = reactFlow.getZoom()
                // 「查看已存在节点」会把镜头跳到同名节点，先记下当前视野好一键返回。
                rememberViewportJump(reactFlow, nextTitle)
                reactFlow.setCenter(nodeRect.x + nodeRect.width / 2, nodeRect.y + nodeRect.height / 2, { zoom, duration: 300 })
              }, 50)
            }
          }
        })
        if (!confirmed) {
          titleDraftRef.current = data.label
          titleSavingRef.current = false
          if (canvas && options?.restoreFocus !== false) {
            requestAnimationFrame(() => canvas.focus())
          }
          return
        }
      } catch (err) {
        console.error('Confirm error:', err)
        titleDraftRef.current = data.label
        titleSavingRef.current = false
        if (canvas && options?.restoreFocus !== false) {
          requestAnimationFrame(() => canvas.focus())
        }
        return
      }
    }

    const renamed = await graph.renameNode(id, nextTitle)
    if (!renamed) titleDraftRef.current = data.label
    titleSavingRef.current = false
    
    if (canvas && options?.restoreFocus !== false) {
      requestAnimationFrame(() => canvas.focus())
    }
  }, [data.label, graph, id, storeApi, canvasReadOnly])

  const cancelTitleEdit = useCallback((options?: { restoreFocus?: boolean }) => {
    const canvas = titleInputRef.current?.closest('[data-shortcut-scope="canvas"]') as HTMLElement | null

    titleDraftRef.current = data.label
    setTitleEditing(false)

    if (canvas && options?.restoreFocus !== false) {
      requestAnimationFrame(() => canvas.focus())
    }
  }, [data.label])

  const startTitleEdit = useCallback((event: React.MouseEvent) => {
    if (!contentInteractionsEnabled || canvasReadOnly) return
    event.preventDefault()
    event.stopPropagation()
    titleDraftRef.current = data.label
    setTitleEditing(true)
  }, [contentInteractionsEnabled, canvasReadOnly, data.label])

  useEffect(() => {
    if (contentInteractionsEnabled) return
    setTitleEditing(false)
  }, [contentInteractionsEnabled])

  useEffect(() => {
    if (titleEditing) return
    if (widthMode !== 'auto' && heightMode !== 'auto') return
    if (isUpdatingDimensionsRef.current) return

    const nextWidth = widthMode === 'auto' ? autoSize.width : nodeWidth
    const nextHeight = heightMode === 'auto' ? autoSize.height : nodeHeight
    if (Math.abs(nextWidth - nodeWidth) < 1 && Math.abs(nextHeight - nodeHeight) < 1) return

    isUpdatingDimensionsRef.current = true
    graph.onNodesChange([{
      id,
      type: 'dimensions',
      dimensions: { width: nextWidth, height: nextHeight },
      resizing: false,
      origin: 'auto-size',
    } as unknown as NodeChange])
    isUpdatingDimensionsRef.current = false
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
    // 只读期不允许启动「点击即写样式」的模式；已在激活态时允许点一次关掉。
    if (canvasReadOnly && useGraphUiStore.getState().formatPainterStyle === null) return
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    } else {
      // 与连线格式刷互斥：启用节点格式刷时先关掉连线格式刷
      uiStore.setEdgeFormatPainterStyle(null)
      uiStore.setFormatPainterStyle(nodeStyle)
    }
  }, [nodeStyle, canvasReadOnly])

  return {
    state: {
      isHovered,
      titleEditing,
      showHoverControls,
      showResizeLabel,
      resizeLabel,
      visuallySelected,
      visuallyHovered,
      isConnectTarget,
      isConnectSource,
      contentInteractionsEnabled,
      isMultiSelected,
      zoomDegradedDuringZoom,
      nodeStyle,
      nodeWidth: displayWidth,
      nodeHeight: displayHeight,
      nodeSizeLimits,
      nodeBadgeSize,
      cardPath,
      widthMode,
      heightMode,
      showQuickToolbar: showQuickToolbarForNode && !titleEditing && !isFormatPainterActive && !isConnecting && !canvasReadOnly,
      decorations,
      isFormatPainterActive,
    },
    actions: {
      setIsHovered,
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
        // 只读期格式刷不生效，也不吞掉点击：用户仍能选中节点看右栏信息。
        if (uiStore.formatPainterStyle !== null && !canvasReadOnly) {
          e.preventDefault()
          e.stopPropagation()
          
          // apply format painter style
          const { headerBackgroundColor, headerFontSize, headerFontWeight, headerFontStyle, headerColor, borderColor, borderWidth, borderRadius } = uiStore.formatPainterStyle
          const patch: KnowledgeNodeStyle = {}
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
      titleInputRef,
      titleDraftRef,
    }
  }
}
