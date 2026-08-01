import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, type Viewport, type NodeChange, type Node, type Edge } from '@xyflow/react'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useShortcut } from '../../../../hooks/useShortcut'
import { logAction } from '../../../../core/log-backend'
import { useSmartGuides } from '../useSmartGuides'
import { buildRectSpatialIndex, distanceToRect, getNodeRect, queryRectSpatialIndex } from '../utils/math'
import { CARD_CONNECT_SNAP_DISTANCE, KEYBOARD_NEW_NODE_HORIZONTAL_GAP, KEYBOARD_NEW_NODE_VERTICAL_GAP } from '../constants'
import type { KnowledgeNode } from '../../../../types'

export interface UseGraphCanvasModelProps {
  tabId: string
  onNodeContextMenu?: (nodeId: string, event: React.MouseEvent) => void
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
  onPaneContextMenu?: (x: number, y: number) => void
  onCloseContextMenu?: () => void
}

export function useGraphCanvasModel({
  tabId,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
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
  
  const [zoomLevel, setZoomLevel] = useState(1)
  const zoomLevelRef = useRef(1)
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
    const candidates = nodes
      .filter((node) => node.id !== connectingSourceId)
      .map((node) => ({ id: node.id, rect: getNodeRect(node as Node) }))
    return buildRectSpatialIndex(candidates, 256)
  }, [connectingSourceId, nodes])
  
  const { guideLines, onNodesChangeIntercept, clearGuides } = useSmartGuides(nodes as Node[])

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

  const handlePaneClick = useCallback(() => {
    onCloseContextMenu?.()
    
    // Check if format painter is active, if so, exit format painter mode
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    }
    
    // Close search box if it's open
    setIsSearchOpen(false)
    
    graph.onPaneClick()
  }, [graph, onCloseContextMenu])

  const updateZoomLevel = useCallback((nextZoom: number) => {
    if (Math.abs(zoomLevelRef.current - nextZoom) <= 0.001) return
    zoomLevelRef.current = nextZoom
    setZoomLevel(nextZoom)
  }, [])

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    updateZoomLevel(viewport.zoom)
  }, [updateZoomLevel])

  const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    updateZoomLevel(viewport.zoom)
    const viewportChanged =
      Math.abs(viewport.x - storedViewport.x) > 0.5 ||
      Math.abs(viewport.y - storedViewport.y) > 0.5 ||
      Math.abs(viewport.zoom - storedViewport.zoom) > 0.001
    if (viewportChanged) setStoredViewport(viewport)
  }, [setStoredViewport, storedViewport, updateZoomLevel])

  useShortcut(['Control+f', 'Meta+f'], (event) => {
    if (activeTabId !== tabId) return
    event.preventDefault()
    setIsSearchOpen(true)
    logAction('快捷键:搜索节点', 'GraphCanvas', { source: 'shortcut' })
  }, { scope: 'global', preventDefault: true })

  useShortcut(['Escape'], (event) => {
    if (activeTabId !== tabId) return
    const uiStore = useGraphUiStore.getState()
    if (uiStore.formatPainterStyle !== null) {
      uiStore.setFormatPainterStyle(null)
    }
    setIsSearchOpen(false)
  }, { scope: 'canvas', preventDefault: false })

  useEffect(() => {
    updateZoomLevel(storedViewport.zoom)
  }, [storedViewport.zoom, updateZoomLevel])

  useShortcut(['Control+z', 'Meta+z'], (event) => {
    if (activeTabId !== tabId) return
    event.preventDefault()
    ;(graphStoreApi as any).temporal.getState().undo()
    const tab = useTabStore.getState().tabs.find(t => t.id === tabId && t.type === 'kb')
    if (tab && 'graphSession' in tab && (tab as any).graphSession?.roomPath) {
      void graph.flushCurrentRoomSave?.()
    }
    logAction('快捷键:撤销', 'GraphCanvas', { source: 'undo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Control+y', 'Meta+y', 'Control+Shift+Z', 'Meta+Shift+Z'], (event) => {
    if (activeTabId !== tabId) return
    event.preventDefault()
    ;(graphStoreApi as any).temporal.getState().redo()
    const tab = useTabStore.getState().tabs.find(t => t.id === tabId && t.type === 'kb')
    if (tab && 'graphSession' in tab && (tab as any).graphSession?.roomPath) {
      void graph.flushCurrentRoomSave?.()
    }
    logAction('快捷键:重做', 'GraphCanvas', { source: 'redo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Enter', 'NumpadEnter', 'Tab'], (event) => {
    if (activeTabId !== tabId) return
    const isEnter = event.key === 'Enter' || event.key === 'NumpadEnter'
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
      logAction('节点:快捷键创建', 'GraphCanvas', {
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
      Math.abs(currentViewport.x - storedViewport.x) > 0.5 ||
      Math.abs(currentViewport.y - storedViewport.y) > 0.5 ||
      Math.abs(currentViewport.zoom - storedViewport.zoom) > 0.001

    if (!viewportChanged) return

    const frame = requestAnimationFrame(() => {
      reactFlow.setViewport(storedViewport, { duration: 0 })
    })

    return () => cancelAnimationFrame(frame)
  }, [reactFlow, storedViewport])

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    graph.onNodeContextMenu(event, node as KnowledgeNode)
    onNodeContextMenu?.(node.id, event)
  }, [graph, onNodeContextMenu])

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
  }, [graph])

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
    onEdgeContextMenu?.(edge.id, event)
  }, [graph, onEdgeContextMenu])

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onPaneContextMenu?.(event.clientX, event.clientY)
  }, [onPaneContextMenu])

  const flushConnectionTargetSearch = useCallback(() => {
    if (!connectingSourceId) return
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
    graph.selectNode(node.id)
    setIsSearchOpen(false)
    const nodeRect = {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? 120,
      height: node.height ?? 52
    }
    const zoom = reactFlow.getZoom()
    reactFlow.setCenter(nodeRect.x + nodeRect.width / 2, nodeRect.y + nodeRect.height / 2, { zoom, duration: 300 })
  }, [graph, reactFlow])

  return {
    state: {
      showGrid,
      connectingSourceId,
      nodes,
      edges,
      storedViewport,
      zoomLevel,
      guideLines,
      isFormatPainterActive,
      isShiftPressed,
      isMouseOverCanvas,
      isSearchOpen,
      isInputFocused,
    },
    graph,
    actions: {
      handleNodesChange,
      handlePaneClick,
      handleMove,
      handleMoveEnd,
      handleNodeContextMenu,
      handleEdgeClick,
      handleEdgeContextMenu,
      handlePaneContextMenu,
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
