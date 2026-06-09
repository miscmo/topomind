import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type Viewport, type NodeChange, type Node, type Edge } from '@xyflow/react'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useShortcut } from '../../../../hooks/useShortcut'
import { logAction } from '../../../../core/log-backend'
import { distanceToRect, getNodeRect } from '../utils/math'
import { CARD_CONNECT_SNAP_DISTANCE, KEYBOARD_NEW_NODE_HORIZONTAL_GAP, KEYBOARD_NEW_NODE_VERTICAL_GAP } from '../constants'
import type { KnowledgeNode } from '../../../../types'

// #region debug-point A/D:node-drag-lag
const DEBUG_SERVER_URL = 'http://127.0.0.1:7777/event'
const DEBUG_SESSION_ID = 'node-drag-lag'
const DEBUG_RUN_ID = 'pre-fix'

function reportNodeDragDebug(hypothesisId: 'A' | 'D', location: string, msg: string, data: Record<string, unknown>) {
  fetch(DEBUG_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: DEBUG_RUN_ID,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {})
}
// #endregion

export interface UseGraphCanvasModelProps {
  tabId: string
  readOnly?: boolean
  allowPaneCreateWhenReadOnly?: boolean
  allowNodeMenuWhenReadOnly?: boolean
  allowLayoutWhenReadOnly?: boolean
  allowEdgeWriteWhenReadOnly?: boolean
  onNodeContextMenu?: (nodeId: string, event: React.MouseEvent) => void
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
  onPaneContextMenu?: (x: number, y: number) => void
  onCloseContextMenu?: () => void
}

export function useGraphCanvasModel({
  tabId,
  readOnly = false,
  allowPaneCreateWhenReadOnly = false,
  allowNodeMenuWhenReadOnly = false,
  allowLayoutWhenReadOnly = false,
  allowEdgeWriteWhenReadOnly = false,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onCloseContextMenu,
}: UseGraphCanvasModelProps) {
  const showGrid = useGraphUiStore((s) => s.showGrid)
  const connectingSourceId = useGraphUiStore((s) => s.connectingSourceId)
  const setConnectingTargetId = useGraphUiStore((s) => s.setConnectingTargetId)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const storedViewport = useGraphStore((s) => s.viewport)
  const setStoredViewport = useGraphStore((s) => s.setViewport)
  const graphStoreApi = useGraphStoreApi()
  const activeTabId = useTabStore((s) => s.activeTabId)
  
  const [zoomLevel, setZoomLevel] = useState(1)
  const zoomLevelRef = useRef(1)
  const dragMetricsRef = useRef({
    active: false,
    startedAt: 0,
    nodeId: '',
    batchCount: 0,
    positionChangeCount: 0,
    nonPositionChangeCount: 0,
    handleNodesChangeMs: 0,
  })
  const reactFlow = useReactFlow()
  const graph = useGraphContext()

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const positionChanges = changes.filter((change) => change.type === 'position')
    const draggingChange = positionChanges.find((change) => change.dragging === true)
    const dragEndChange = positionChanges.find((change) => change.dragging === false)
    const sharedDebugState = ((window as any).__nodeDragLagDebug ??= {
      active: false,
      renderCount: 0,
      draggingNodeRenderCount: 0,
      renderNodeIds: {} as Record<string, number>,
      applyNodePositionCalls: 0,
      applyNodePositionMs: 0,
    })
    const metrics = dragMetricsRef.current

    if (draggingChange && !metrics.active) {
      metrics.active = true
      metrics.startedAt = performance.now()
      metrics.nodeId = draggingChange.id
      metrics.batchCount = 0
      metrics.positionChangeCount = 0
      metrics.nonPositionChangeCount = 0
      metrics.handleNodesChangeMs = 0
      sharedDebugState.active = true
      sharedDebugState.renderCount = 0
      sharedDebugState.draggingNodeRenderCount = 0
      sharedDebugState.renderNodeIds = {}
      sharedDebugState.applyNodePositionCalls = 0
      sharedDebugState.applyNodePositionMs = 0
      reportNodeDragDebug('A', 'useGraphCanvasModel:handleNodesChange:start', '[DEBUG] drag session started', {
        nodeId: draggingChange.id,
        changeCount: changes.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      })
    }

    if (metrics.active) {
      metrics.batchCount += 1
      metrics.positionChangeCount += positionChanges.length
      metrics.nonPositionChangeCount += changes.length - positionChanges.length
    }

    const handlerStartedAt = performance.now()
    graph.onNodesChange(changes)
    if (metrics.active) {
      metrics.handleNodesChangeMs += performance.now() - handlerStartedAt
    }

    if (metrics.active && dragEndChange) {
      const renderedNodeIds = Object.keys(sharedDebugState.renderNodeIds ?? {})
      reportNodeDragDebug('A', 'useGraphCanvasModel:handleNodesChange:end', '[DEBUG] drag session ended', {
        nodeId: metrics.nodeId || dragEndChange.id,
        durationMs: Math.round(performance.now() - metrics.startedAt),
        batchCount: metrics.batchCount,
        positionChangeCount: metrics.positionChangeCount,
        nonPositionChangeCount: metrics.nonPositionChangeCount,
        handleNodesChangeMs: Number(metrics.handleNodesChangeMs.toFixed(2)),
        totalCardRenders: sharedDebugState.renderCount ?? 0,
        draggingNodeRenderCount: sharedDebugState.draggingNodeRenderCount ?? 0,
        renderedNodeCount: renderedNodeIds.length,
        topRenderedNodes: renderedNodeIds
          .sort((left, right) => (sharedDebugState.renderNodeIds[right] ?? 0) - (sharedDebugState.renderNodeIds[left] ?? 0))
          .slice(0, 5)
          .map((nodeId: string) => ({ nodeId, renders: sharedDebugState.renderNodeIds[nodeId] ?? 0 })),
        applyNodePositionCalls: sharedDebugState.applyNodePositionCalls ?? 0,
        applyNodePositionMs: Number((sharedDebugState.applyNodePositionMs ?? 0).toFixed(2)),
      })
      metrics.active = false
      metrics.nodeId = ''
      sharedDebugState.active = false
    }
  }, [graph])

  const handlePaneClick = useCallback(() => {
    onCloseContextMenu?.()
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
    if (!viewportChanged) return
    setStoredViewport(viewport)
    if (!readOnly || allowLayoutWhenReadOnly) {
      void graph.flushCurrentRoomSave()
    }
  }, [allowLayoutWhenReadOnly, graph, readOnly, setStoredViewport, storedViewport, updateZoomLevel])

  useEffect(() => {
    updateZoomLevel(storedViewport.zoom)
  }, [storedViewport.zoom, updateZoomLevel])

  useShortcut(['Control+z', 'Meta+z'], (event) => {
    if (readOnly) return
    if (activeTabId !== tabId) return
    event.preventDefault()
    ;(graphStoreApi as any).temporal.getState().undo()
    logAction('快捷键:撤销', 'GraphCanvas', { source: 'undo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Control+y', 'Meta+y', 'Control+Shift+Z', 'Meta+Shift+Z'], (event) => {
    if (readOnly) return
    if (activeTabId !== tabId) return
    event.preventDefault()
    ;(graphStoreApi as any).temporal.getState().redo()
    logAction('快捷键:重做', 'GraphCanvas', { source: 'redo' })
  }, { scope: 'canvas', preventDefault: true })

  useShortcut(['Enter', 'NumpadEnter', 'Tab'], (event) => {
    if (readOnly) return
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

  const handleConnectionMouseMove = useCallback((event: React.MouseEvent) => {
    if (!connectingSourceId) return
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    let nextTargetId: string | null = null
    let bestDistance = Infinity
    for (const node of nodes) {
      if (node.id === connectingSourceId) continue
      const distance = distanceToRect(point, getNodeRect(node as Node))
      if (distance <= CARD_CONNECT_SNAP_DISTANCE && distance < bestDistance) {
        bestDistance = distance
        nextTargetId = node.id
      }
    }
    if (useGraphUiStore.getState().connectingTargetId !== nextTargetId) {
      setConnectingTargetId(nextTargetId)
    }
  }, [connectingSourceId, nodes, reactFlow, setConnectingTargetId])

  const handleConnectionMouseLeave = useCallback(() => {
    if (!connectingSourceId) return
    setConnectingTargetId(null)
  }, [connectingSourceId, setConnectingTargetId])

  return {
    state: {
      showGrid,
      connectingSourceId,
      nodes,
      edges,
      storedViewport,
      zoomLevel,
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
      readOnly,
      allowPaneCreateWhenReadOnly,
      allowNodeMenuWhenReadOnly,
      allowLayoutWhenReadOnly,
      allowEdgeWriteWhenReadOnly,
    }
  }
}
