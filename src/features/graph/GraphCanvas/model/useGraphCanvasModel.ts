import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type Viewport, type NodeChange, type Node, type Edge } from '@xyflow/react'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore } from '../../../../stores/graphStore'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useShortcut } from '../../../../hooks/useShortcut'
import { logAction } from '../../../../core/log-backend'
import { useSmartGuides } from '../useSmartGuides'
import { distanceToRect, getNodeRect } from '../utils/math'
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
  const setConnectingTargetId = useGraphUiStore((s) => s.setConnectingTargetId)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const storedViewport = useGraphStore((s) => s.viewport)
  const setStoredViewport = useGraphStore((s) => s.setViewport)
  const activeTabId = useTabStore((s) => s.activeTabId)
  
  const [zoomLevel, setZoomLevel] = useState(1)
  const zoomLevelRef = useRef(1)
  const reactFlow = useReactFlow()
  const graph = useGraphContext()
  
  const { guideLines, onNodesChangeIntercept, clearGuides } = useSmartGuides(nodes as Node[])

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const nextChanges = onNodesChangeIntercept(changes)
    graph.onNodesChange(nextChanges)
  }, [graph, onNodesChangeIntercept])

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
    if (viewportChanged) setStoredViewport(viewport)
  }, [setStoredViewport, storedViewport, updateZoomLevel])

  useEffect(() => {
    updateZoomLevel(storedViewport.zoom)
  }, [storedViewport.zoom, updateZoomLevel])

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
      guideLines,
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
    }
  }
}
