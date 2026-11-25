import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, type Viewport, type NodeChange, type Node, type Edge } from '@xyflow/react'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useRightPanelStore } from '../../../../stores/rightPanelStore'
import { getActiveCanvasReadOnly, isCanvasReadOnly } from '../../../../stores/canvasReadOnlyStore'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { CANVAS_OPERATIONS } from '../../../../shared/observability/performanceContract'
import {
  PERFORMANCE_METRICS,
  newPerformanceTraceId,
  recordPerformance,
} from '../../../../core/performance-log'
import { readCanvasScale, startCanvasSpan } from '../../../../hooks/useGraph/canvasPerformanceContext'
import { resolveGestureSampleTiming } from '../../../../shared/observability/gestureTiming'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useEdgeRelationEditorStore, useEdgeRelationPickerStore } from '../../../../stores/edgeRelationPickerStore'
import { useShortcut } from '../../../../hooks/useShortcut'
import { logAction } from '../../../../core/log-backend'
import { useSmartGuides } from '../useSmartGuides'
import { buildRectSpatialIndex, distanceToRect, getNodeRect, queryRectSpatialIndex } from '../utils/math'
import { CARD_CONNECT_SNAP_DISTANCE, KEYBOARD_NEW_NODE_HORIZONTAL_GAP, KEYBOARD_NEW_NODE_VERTICAL_GAP } from '../constants'
import {
  ZOOM_REFERENCE,
  quantizeLodZoom,
  rebaseViewport,
  resolveLodStage,
} from '../../../../domain/graph/zoomScale'
import type { KnowledgeNode } from '../../../../types'
import { rememberViewportJump } from './viewportReturnStore'

export interface UseGraphCanvasModelProps {
  tabId: string
  onNodeContextMenu?: (nodeId: string, event: React.MouseEvent) => void
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
  onPaneContextMenu?: (x: number, y: number) => void
  /** 选区包围盒上的右键：xyflow 会用 .react-flow__nodesselection-rect 覆盖选中区域，
   *  此时 node / pane 的右键回调都不会触发，必须单独接 onSelectionContextMenu。
   *  nodeIds 是 xyflow 内部认为的选中集合，用于单选时回落到完整节点菜单。 */
  onSelectionContextMenu?: (x: number, y: number, nodeIds: string[]) => void
  onCloseContextMenu?: () => void
}

export function useGraphCanvasModel({
  tabId,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onSelectionContextMenu,
  onCloseContextMenu,
}: UseGraphCanvasModelProps) {
  const showGrid = useGraphUiStore((s) => s.showGrid)
  const connectingSourceId = useGraphUiStore((s) => s.connectingSourceId)
  const connectingTargetId = useGraphUiStore((s) => s.connectingTargetId)
  const setConnectingTargetId = useGraphUiStore((s) => s.setConnectingTargetId)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const storedViewport = useGraphStore((s) => s.viewport)
  const setStoredViewport = useGraphStore((s) => s.setViewport)
  const graphStoreApi = useGraphStoreApi()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  // pin 偏好按房间隔离，避免同名节点 id 跨房间串味。
  // 必须用官方 getGraphSession（会话不一定挂在 tabs 数组元素上），否则 roomPath 恒为空 → pin 写不进去。
  const roomPath = useTabStore((s) => s.getGraphSession(tabId)?.roomPath ?? '')

  // zoomLevel 是 raw 变换系数（缩略图算可见框用），显示百分比由 zoomScale 统一换算。
  const [zoomLevel, setZoomLevel] = useState(ZOOM_REFERENCE)
  const zoomLevelRef = useRef(ZOOM_REFERENCE)
  // LOD 吃量化后的连续 zoom：滚轮每帧变，但只有跨 2% 显示比台阶才 setState。
  const [lodZoom, setLodZoom] = useState(() => quantizeLodZoom(ZOOM_REFERENCE))
  const lodZoomRef = useRef(lodZoom)
  // 粗档位只用来清空「搜索临时显示」，不参与可见性裁剪。
  const [lodTier, setLodTier] = useState(() => resolveLodStage(ZOOM_REFERENCE))
  const lodTierRef = useRef(lodTier)
  // 落盘值不改写：仅在交给 ReactFlow 时把两个历史默认镜头（raw 1 / 0.5）重定基到新的 100%，并钳到上下限。
  const renderViewport = useMemo(() => rebaseViewport(storedViewport), [storedViewport])
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isMouseOverCanvas, setIsMouseOverCanvas] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [isCanvasPointerActive, setIsCanvasPointerActive] = useState(false)
  const pendingConnectionPointRef = useRef<{ x: number; y: number } | null>(null)
  const connectionFrameRef = useRef<number | null>(null)
  const connectingTargetIdRef = useRef<string | null>(connectingTargetId)
  const previousBodyUserSelectRef = useRef<string | null>(null)

  useEffect(() => {
    const checkFocus = () => {
      const activeElement = document.activeElement
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || activeElement?.getAttribute('contenteditable') === 'true'
      setIsInputFocused(!!isInput)
    }
    
    const handleFocusIn = () => checkFocus()
    const handleFocusOut = () => checkFocus()

    checkFocus()
    window.addEventListener('focusin', handleFocusIn)
    window.addEventListener('focusout', handleFocusOut)

    return () => {
      window.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (connectionFrameRef.current !== null) {
        cancelAnimationFrame(connectionFrameRef.current)
        connectionFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false)
      }
    }
    const handleBlur = () => setIsShiftPressed(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const reactFlow = useReactFlow()
  const graph = useGraphContext()
  const snapCandidateIndex = useMemo(() => {
    if (!connectingSourceId) return null
    const candidates = nodes
      .filter((node) => node.id !== connectingSourceId)
      .map((node) => ({ id: node.id, rect: getNodeRect(node as Node) }))
    return buildRectSpatialIndex(candidates, 256)
  }, [connectingSourceId, nodes])
  
  // LOD 派生后真正渲染的节点由 GraphCanvas 在 useSemanticLod 之后写入这个 ref：
  // 参考线只跟屏幕上存在的对象对齐，不再扫全图。
  const visibleNodesRef = useRef<Node[] | null>(null)
  const getSmartGuideZoom = useCallback(() => zoomLevelRef.current, [])
  const getSmartGuideVisibleNodes = useCallback(() => visibleNodesRef.current, [])
  const { guideLines, onNodesChangeIntercept } = useSmartGuides(nodes as Node[], {
    getZoom: getSmartGuideZoom,
    getVisibleNodes: getSmartGuideVisibleNodes,
  })

  useEffect(() => {
    connectingTargetIdRef.current = connectingTargetId
  }, [connectingTargetId])

  useEffect(() => {
    return () => {
      if (connectionFrameRef.current !== null) {
        cancelAnimationFrame(connectionFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isCanvasPointerActive) return

    previousBodyUserSelectRef.current = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    const releasePointerLock = () => {
      const selection = window.getSelection()
      if (selection && selection.type === 'Range') {
        selection.removeAllRanges()
      }
      setIsCanvasPointerActive(false)
    }

    window.addEventListener('mouseup', releasePointerLock)
    window.addEventListener('pointerup', releasePointerLock)
    window.addEventListener('pointercancel', releasePointerLock)
    window.addEventListener('dragend', releasePointerLock)
    window.addEventListener('blur', releasePointerLock)

    return () => {
      window.removeEventListener('mouseup', releasePointerLock)
      window.removeEventListener('pointerup', releasePointerLock)
      window.removeEventListener('pointercancel', releasePointerLock)
      window.removeEventListener('dragend', releasePointerLock)
      window.removeEventListener('blur', releasePointerLock)
      document.body.style.userSelect = previousBodyUserSelectRef.current ?? ''
      previousBodyUserSelectRef.current = null
    }
  }, [isCanvasPointerActive])

  useEffect(() => {
    if (connectingSourceId) return
    pendingConnectionPointRef.current = null
    if (connectionFrameRef.current !== null) {
      cancelAnimationFrame(connectionFrameRef.current)
      connectionFrameRef.current = null
    }
    connectingTargetIdRef.current = null
  }, [connectingSourceId])

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const nextChanges = onNodesChangeIntercept(changes)
    graph.onNodesChange(nextChanges)
  }, [graph, onNodesChangeIntercept])

  // 只有 React Flow 真正派发的画布点击（带事件对象）才触发右栏自动折叠；
  // 关系浮层关闭等程序化 onPaneClick 不带事件，不能把用户正在看的面板一起收掉。
  const handlePaneClick = useCallback((event?: React.MouseEvent) => {
    onCloseContextMenu?.()
    
    // Check if format painter is active, if so, exit format painter mode
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    }
    if (uiStore.edgeFormatPainterStyle !== null) {
      uiStore.setEdgeFormatPainterStyle(null)
    }
    
    // Close search box if it's open
    setIsSearchOpen(false)
    
    graph.onPaneClick()
    if (event) useRightPanelStore.getState().applyRightPanelAutoVisibility(false)
  }, [graph, onCloseContextMenu])

  const updateZoomLevel = useCallback((nextZoom: number) => {
    const nextLodZoom = quantizeLodZoom(nextZoom)
    if (Math.abs(nextLodZoom - lodZoomRef.current) > 0.0001) {
      lodZoomRef.current = nextLodZoom
      setLodZoom(nextLodZoom)
    }
    const nextStage = resolveLodStage(nextZoom)
    if (nextStage !== lodTierRef.current) {
      lodTierRef.current = nextStage
      setLodTier(nextStage)
    }
    if (Math.abs(zoomLevelRef.current - nextZoom) <= 0.001) return
    zoomLevelRef.current = nextZoom
    setZoomLevel(nextZoom)
  }, [])

  // 区分"缩放"和"平移"：只有缩放会让大批节点进出视口，需要降级渲染。
  // 这里靠 zoom 是否变化来判断——onMove 对平移和缩放都会触发，但平移时 zoom 恒定。
  const zoomingRef = useRef(false)
  const lastMoveZoomRef = useRef<number | null>(null)
  const zoomEndTimerRef = useRef<number | null>(null)
  const gestureEndTimerRef = useRef<number | null>(null)
  const viewportGestureRef = useRef<{
    operation: 'zoom' | 'pan'
    traceId: string
    startedAt: number
    lastFrameAt: number
    frameCount: number
    maxFrameMs: number
    zoomFrom: number
    zoomTo: number
    hiddenBefore: number
  } | null>(null)

  // 缩放 / 平移按一次手势上报一条样本：每帧只更新 ref，帧内不写日志、不 setState。
  const finishViewportGesture = useCallback(() => {
    if (gestureEndTimerRef.current !== null) {
      window.clearTimeout(gestureEndTimerRef.current)
      gestureEndTimerRef.current = null
    }
    const gesture = viewportGestureRef.current
    if (!gesture) return
    viewportGestureRef.current = null
    const operation = gesture.operation === 'zoom' ? CANVAS_OPERATIONS.zoom : CANVAS_OPERATIONS.pan
    // durationMs 只取最慢一帧；总时长（含按住不动）另存 elapsedMs，见 gestureTiming.ts。
    const timing = resolveGestureSampleTiming({
      frameCount: gesture.frameCount,
      maxFrameMs: gesture.maxFrameMs,
      elapsedMs: performance.now() - gesture.startedAt,
      dropSingleFrame: false,
    })
    if (!timing) return
    recordPerformance(PERFORMANCE_METRICS.canvasGesture, timing.durationMs, {
      module: 'GraphCanvas',
      traceId: gesture.traceId,
      contextKey: roomPath,
      params: {
        frameCount: gesture.frameCount,
        maxFrameMs: timing.maxFrameMs,
        elapsedMs: timing.elapsedMs,
        zoomFrom: Number(gesture.zoomFrom.toFixed(3)),
        zoomTo: Number(gesture.zoomTo.toFixed(3)),
        hiddenBefore: gesture.hiddenBefore,
        hiddenAfter: getActiveCanvasReadOnly().hiddenNodeCount,
        ...readCanvasScale(graphStoreApi, { operation, roomPath }),
      },
    })
  }, [graphStoreApi, roomPath])

  const endZooming = useCallback(() => {
    if (zoomEndTimerRef.current !== null) {
      window.clearTimeout(zoomEndTimerRef.current)
      zoomEndTimerRef.current = null
    }
    finishViewportGesture()
    if (!zoomingRef.current) return
    zoomingRef.current = false
    useGraphUiStore.getState().setViewportZooming(false)
  }, [finishViewportGesture])

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    updateZoomLevel(viewport.zoom)
    const previousZoom = lastMoveZoomRef.current
    lastMoveZoomRef.current = viewport.zoom
    const zoomChanged = previousZoom !== null && Math.abs(viewport.zoom - previousZoom) > 0.0005

    // 手势会话：逐帧只在 ref 里累加，绝不在这里写日志或 setState。
    const now = performance.now()
    let gesture = viewportGestureRef.current
    if (!gesture) {
      gesture = {
        operation: zoomChanged ? 'zoom' : 'pan',
        traceId: newPerformanceTraceId('viewport'),
        startedAt: now,
        lastFrameAt: now,
        frameCount: 0,
        maxFrameMs: 0,
        zoomFrom: previousZoom ?? viewport.zoom,
        zoomTo: viewport.zoom,
        hiddenBefore: getActiveCanvasReadOnly().hiddenNodeCount,
      }
      viewportGestureRef.current = gesture
    }
    gesture.frameCount += 1
    gesture.maxFrameMs = Math.max(gesture.maxFrameMs, now - gesture.lastFrameAt)
    gesture.lastFrameAt = now
    gesture.zoomTo = viewport.zoom
    if (zoomChanged) gesture.operation = 'zoom'
    if (gestureEndTimerRef.current !== null) window.clearTimeout(gestureEndTimerRef.current)
    gestureEndTimerRef.current = window.setTimeout(finishViewportGesture, 180)

    if (zoomChanged) {
      // 只在 false → true 时写 store，避免缩放期间每帧 setState
      if (!zoomingRef.current) {
        zoomingRef.current = true
        useGraphUiStore.getState().setViewportZooming(true)
      }
      // 兜底：程序化变换（fitView / setViewport）不一定触发 onMoveEnd，
      // 没有这个定时器会让所有节点永远停在最低细节档。
      if (zoomEndTimerRef.current !== null) window.clearTimeout(zoomEndTimerRef.current)
      zoomEndTimerRef.current = window.setTimeout(endZooming, 180)
    }
  }, [endZooming, finishViewportGesture, updateZoomLevel])

  useEffect(() => () => endZooming(), [endZooming])

  const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    updateZoomLevel(viewport.zoom)
    endZooming()
    const viewportChanged =
      Math.abs(viewport.x - storedViewport.x) > 0.5 ||
      Math.abs(viewport.y - storedViewport.y) > 0.5 ||
      Math.abs(viewport.zoom - storedViewport.zoom) > 0.001
    if (viewportChanged) setStoredViewport(viewport)
    finishViewportGesture()
  }, [finishViewportGesture, setStoredViewport, storedViewport, updateZoomLevel])

  useShortcut(['Control+f', 'Meta+f'], (event) => {
    if (activeTabId !== tabId) return
    // global 快捷键在 window 捕获阶段执行，比容器 onKeyDownCapture 更早，
    // 只能在回调里自行让位给活跃容器，否则白板内查找会被外层节点搜索截走。
    if (document.querySelector('[data-tm-container-surface="active"]')) return
    event.preventDefault()
    setIsSearchOpen(true)
    logAction('ui.shortcut', 'GraphCanvas', { source: 'shortcut' })
  }, { scope: 'global', preventDefault: true })

  useShortcut(['Escape'], (_event) => {
    if (activeTabId !== tabId) return
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    }
    if (uiStore.edgeFormatPainterStyle !== null) {
      uiStore.setEdgeFormatPainterStyle(null)
    }
    setIsSearchOpen(false)
  }, { scope: 'canvas', preventDefault: false })

  useEffect(() => {
    updateZoomLevel(renderViewport.zoom)
  }, [renderViewport.zoom, updateZoomLevel])

  useShortcut(['Control+z', 'Meta+z'], (event) => {
    if (activeTabId !== tabId) return
    // 撤销/重做会直接写回 graphStore（绕过 useGraph 闸门），只读期同样禁止改图。
    if (isCanvasReadOnly(tabId)) return
    event.preventDefault()
    ;graphStoreApi.temporal.getState().undo()
    const tab = useTabStore.getState().tabs.find(t => t.id === tabId && t.type === 'kb')
    if (tab && 'graphSession' in tab && (tab as unknown as { graphSession?: { roomPath?: string } }).graphSession?.roomPath) {
      void graph.flushCurrentRoomSave?.()
    }
    logAction('ui.shortcut', 'GraphCanvas', { source: 'undo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Control+y', 'Meta+y', 'Control+Shift+Z', 'Meta+Shift+Z'], (event) => {
    if (activeTabId !== tabId) return
    if (isCanvasReadOnly(tabId)) return
    event.preventDefault()
    ;graphStoreApi.temporal.getState().redo()
    const tab = useTabStore.getState().tabs.find(t => t.id === tabId && t.type === 'kb')
    if (tab && 'graphSession' in tab && (tab as unknown as { graphSession?: { roomPath?: string } }).graphSession?.roomPath) {
      void graph.flushCurrentRoomSave?.()
    }
    logAction('ui.shortcut', 'GraphCanvas', { source: 'redo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Enter', 'NumpadEnter', 'Tab'], (event) => {
    if (activeTabId !== tabId) return
    // 快捷键新建节点 + 自动连线属于编辑，只读期不落盘（底层闸门也会拦，这里省掉确认框）。
    if (isCanvasReadOnly(tabId)) return
    const isTab = event.key === 'Tab'

    const selectedNode = nodes.find((node) => node.selected)
    if (!selectedNode) return

    const rect = getNodeRect(selectedNode as Node)
    const position = isTab
      ? {
          x: rect.x + rect.width + KEYBOARD_NEW_NODE_HORIZONTAL_GAP,
          y: rect.y,
        }
      : {
          x: rect.x,
          y: rect.y + rect.height + KEYBOARD_NEW_NODE_VERTICAL_GAP,
        }

    event.preventDefault()
    void (async () => {
      logAction('node.create', 'GraphCanvas', {
        source: isTab ? 'tab-create-right-sibling' : 'enter-below-selected-node',
        selectedNodeId: selectedNode.id,
        position,
      })
      const newNodeId = await graph.createChildNode('新节点', undefined, position, { editTitle: true })
      if (isTab && newNodeId) {
        await graph.createEdge(selectedNode.id, newNodeId)
      }
    })()
  }, { scope: 'canvas', preventDefault: false })

  useEffect(() => {
    const currentViewport = reactFlow.getViewport()
    const viewportChanged =
      Math.abs(currentViewport.x - renderViewport.x) > 0.5 ||
      Math.abs(currentViewport.y - renderViewport.y) > 0.5 ||
      Math.abs(currentViewport.zoom - renderViewport.zoom) > 0.001

    if (!viewportChanged) return

    const frame = requestAnimationFrame(() => {
      reactFlow.setViewport(renderViewport, { duration: 0 })
    })

    return () => cancelAnimationFrame(frame)
  }, [reactFlow, renderViewport])

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    // 右键菜单里全是新建 / 删除 / 样式 / 移动 / 关联等编辑项：只读时干脆不弹出，
    // 顺手关掉可能残留的旧菜单，避免「菜单可见但点了没反应」。
    if (isCanvasReadOnly(tabId)) {
      event.preventDefault()
      event.stopPropagation()
      onCloseContextMenu?.()
      return
    }
    graph.onNodeContextMenu(event, node as KnowledgeNode)
    onNodeContextMenu?.(node.id, event)
  }, [graph, onNodeContextMenu, onCloseContextMenu, tabId])

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
  }, [graph])

  /**
   * 双击连线 → 在双击处打开轻量关系编辑器（自定义关系名 / 切换关联·从属）。
   * 只读时与右键菜单一样干脆不弹；格式刷是「点击即写」模式，双击不抢它的语义。
   * 写入仍由 useGraph 的唯一写闸门兜底，这里只负责开浮层。
   */
  const handleEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (isCanvasReadOnly(tabId)) return
    const ui = useGraphUiStore.getState()
    if (ui.edgeFormatPainterStyle || ui.formatPainterStyle) return
    event.stopPropagation()
    onCloseContextMenu?.()
    // 与「新建连线必选关系」浮层互斥，避免两个菜单叠在一起。
    useEdgeRelationPickerStore.getState().close()
    useEdgeRelationEditorStore.getState().open({
      edgeId: edge.id,
      anchor: { x: event.clientX, y: event.clientY },
    })
  }, [tabId, onCloseContextMenu])

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (isCanvasReadOnly(tabId)) {
      event.preventDefault()
      event.stopPropagation()
      onCloseContextMenu?.()
      return
    }
    graph.onEdgeClick(event, edge)
    onEdgeContextMenu?.(edge.id, event)
  }, [graph, onEdgeContextMenu, onCloseContextMenu, tabId])

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (isCanvasReadOnly(tabId)) {
      onCloseContextMenu?.()
      return
    }
    onPaneContextMenu?.(event.clientX, event.clientY)
  }, [onPaneContextMenu, onCloseContextMenu, tabId])

  /**
   * 多选（框选 / 选中子树 / Shift 点选）后，xyflow 会在选中节点包围盒上盖一层
   * .react-flow__nodesselection-rect (pointer-events: all, z-index 3)。右键落在它上面时
   * 既不是 node、也不是 pane，旧实现两个回调都收不到 → 「右键呼不出任何菜单」。
   * 这里统一转成和 pane 右键相同的入口，由页面层用冻结的选中快照渲染多选菜单。
   */
  const handleSelectionContextMenu = useCallback((event: React.MouseEvent, selectedNodes: Node[]) => {
    event.preventDefault()
    event.stopPropagation()
    if (isCanvasReadOnly(tabId)) {
      onCloseContextMenu?.()
      return
    }
    onSelectionContextMenu?.(event.clientX, event.clientY, selectedNodes.map((node) => node.id))
  }, [onSelectionContextMenu, onCloseContextMenu, tabId])

  /**
   * 容器级兜底：上面三个 xyflow 回调都会 stopPropagation，被它们接住的事件不会冒泡到这里。
   * 只有「某个 react-flow 内部覆盖层把右键吞了、三个回调都没接到」时才会走到这里 ——
   * 这正是「框选后右键呼不出任何菜单」这类问题的通用形态。此时仍给画布一个可用菜单，
   * 而不是让右键毫无反应。工具栏 / 搜索框 / 缩略图等控件不在白名单内，不抢它们的菜单。
   */
  const handleCanvasContextMenuFallback = useCallback((event: React.MouseEvent) => {
    if (event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof Element)) return
    const insideGraphLayer = target.closest(
      '.react-flow__pane, .react-flow__node, .react-flow__edge, .react-flow__nodesselection, .react-flow__selection, .react-flow__viewport'
    )
    if (!insideGraphLayer) return
    event.preventDefault()
    if (isCanvasReadOnly(tabId)) {
      onCloseContextMenu?.()
      return
    }
    onPaneContextMenu?.(event.clientX, event.clientY)
  }, [tabId, onPaneContextMenu, onCloseContextMenu])

  const flushConnectionTargetSearch = useCallback(() => {
    if (!connectingSourceId || !snapCandidateIndex) return
    const pendingPoint = pendingConnectionPointRef.current
    if (!pendingPoint) return
    const point = reactFlow.screenToFlowPosition(pendingPoint)
    let nextTargetId: string | null = null
    let bestDistance = Infinity
    for (const candidate of queryRectSpatialIndex(snapCandidateIndex, point, CARD_CONNECT_SNAP_DISTANCE)) {
      const distance = distanceToRect(point, candidate.rect)
      if (distance <= CARD_CONNECT_SNAP_DISTANCE && distance < bestDistance) {
        bestDistance = distance
        nextTargetId = candidate.id
      }
    }
    if (connectingTargetIdRef.current !== nextTargetId) {
      connectingTargetIdRef.current = nextTargetId
      setConnectingTargetId(nextTargetId)
    }
  }, [connectingSourceId, reactFlow, setConnectingTargetId, snapCandidateIndex])

  const handleConnectionMouseMove = useCallback((event: React.MouseEvent) => {
    if (!connectingSourceId) return
    pendingConnectionPointRef.current = { x: event.clientX, y: event.clientY }
    if (connectionFrameRef.current !== null) return
    connectionFrameRef.current = requestAnimationFrame(() => {
      connectionFrameRef.current = null
      flushConnectionTargetSearch()
    })
  }, [connectingSourceId, flushConnectionTargetSearch])

  const handleConnectionMouseLeave = useCallback(() => {
    if (!connectingSourceId) return
    pendingConnectionPointRef.current = null
    if (connectionFrameRef.current !== null) {
      cancelAnimationFrame(connectionFrameRef.current)
      connectionFrameRef.current = null
    }
    if (connectingTargetIdRef.current !== null) {
      connectingTargetIdRef.current = null
      setConnectingTargetId(null)
    }
  }, [connectingSourceId, setConnectingTargetId])

  const isFormatPainterActive = useGraphUiStore((s) => s.formatPainterStyle !== null)
  const isEdgeFormatPainterActive = useGraphUiStore((s) => s.edgeFormatPainterStyle !== null)
  // 缩放时 zoom 每帧都在变，而 zoomLevel 只喂给缩略图（算可见框 + 显示百分比）。
  // 用 deferred 值把缩略图的更新降级为可中断渲染，主画布不必等它画完。
  const deferredZoomLevel = useDeferredValue(zoomLevel)

  const handleCanvasMouseEnter = useCallback((e: React.MouseEvent) => {
    setIsMouseOverCanvas(true)
    setIsShiftPressed(e.shiftKey)
  }, [])

  const handleCanvasMouseLeave = useCallback((e: React.MouseEvent) => {
    setIsMouseOverCanvas(false)
    setIsShiftPressed(e.shiftKey)
    if (connectingSourceId) {
      handleConnectionMouseLeave()
    }
  }, [connectingSourceId, handleConnectionMouseLeave])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isShiftPressed !== e.shiftKey) {
      setIsShiftPressed(e.shiftKey)
    }
    if (connectingSourceId) {
      handleConnectionMouseMove(e)
    }
  }, [isShiftPressed, connectingSourceId, handleConnectionMouseMove])

  const handleCanvasMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof HTMLElement)) {
      setIsCanvasPointerActive(true)
      return
    }

    const editableTarget = event.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
    if (editableTarget) return

    setIsCanvasPointerActive(true)
  }, [])

  const handleSearchSelectNode = useCallback((node: Node) => {
    const perfSpan = startCanvasSpan(graphStoreApi, {
      operation: CANVAS_OPERATIONS.locate,
      metric: PERFORMANCE_METRICS.canvasQuery,
      module: 'canvasModel',
      params: { trigger: 'canvas-search', targetNodeId: node.id },
    })
    graph.selectNode(node.id)
    setIsSearchOpen(false)
    // 程序化跳转前记下当前视野；手动平移 / 滚轮缩放不经过这里，不会污染返回历史。
    rememberViewportJump(reactFlow, String(node.data?.label ?? node.id))
    const nodeRect = {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? 120,
      height: node.height ?? 52
    }
    const zoom = reactFlow.getZoom()
    reactFlow.setCenter(nodeRect.x + nodeRect.width / 2, nodeRect.y + nodeRect.height / 2, { zoom, duration: 300 })
    // setCenter 的 300ms 镜头动画由 finishViewportGesture 的手势样本覆盖；
    // 这里只量同步定位部分，并把动画时长如实记进上下文，不伪造耗时。
    perfSpan.end({ zoom: Number(zoom.toFixed(3)), animationMs: 300 })
  }, [graph, reactFlow, graphStoreApi])

  return {
    state: {
      showGrid,
      connectingSourceId,
      nodes,
      edges,
      storedViewport,
      renderViewport,
      zoomLevel: deferredZoomLevel,
      lodZoom,
      lodTier,
      roomPath,
      selectedNodeId,
      guideLines,
      isFormatPainterActive,
      isEdgeFormatPainterActive,
      isShiftPressed,
      isMouseOverCanvas,
      isSearchOpen,
      isInputFocused,
    },
    visibleNodesRef,
    graph,
    actions: {
      handleNodesChange,
      handlePaneClick,
      handleMove,
      handleMoveEnd,
      handleNodeContextMenu,
      handleEdgeClick,
      handleEdgeDoubleClick,
      handleEdgeContextMenu,
      handlePaneContextMenu,
      handleSelectionContextMenu,
      handleCanvasContextMenuFallback,
      handleConnectionMouseMove,
      handleConnectionMouseLeave,
      handleCanvasMouseEnter,
      handleCanvasMouseLeave,
      handleCanvasMouseMove,
      handleCanvasMouseDown,
      setIsSearchOpen,
      handleSearchSelectNode,
    }
  }
}
