import { useCallback, useEffect, useRef } from 'react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { tabStore } from '../../stores/tabs/tabStore'
import { logAction } from '../../core/log-backend'
import { markPerformanceMetricStart, PERFORMANCE_METRICS } from '../../core/performance-log'
import type { KnowledgeNodeData } from '../../types'
import type { RightPanelTab } from '../../types/uiStoreTypes'
import { generateId } from './graphBuilder'
import type { GraphOperations } from './graphOperations'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { useGraphUiStore } from '../../stores/graphUiStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface GraphEventHandlerDeps {
  tabId: string
  ops: GraphOperations
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  setSelectedEdgeId: (edgeId: string | null) => void
  storeApi: StoreApi<GraphState>
}

export function useGraphEventHandlers(deps: GraphEventHandlerDeps) {
  const {
    tabId,
    ops,
    getActiveGraphSession,
    defaultEdgeStyle,
    setSelectedEdgeId,
    storeApi,
  } = deps
  const navigationTargetRef = useRef('')
  const navigationResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (navigationResetTimerRef.current !== null) {
        window.clearTimeout(navigationResetTimerRef.current)
      }
    }
  }, [])

  const resetConnectTargetHighlight = useCallback(() => {
    const graphUi = useGraphUiStore.getState()
    graphUi.setConnectingSourceId(null)
    graphUi.setConnectingTargetId(null)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges: Array<{ id: string; position?: { x: number; y: number }; dragging?: boolean }> = []
      const removeIds: string[] = []
      const dimensionChanges: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean; origin?: 'auto-size' | 'manual' }> = []
      const selectionChanges: Array<{ id: string; selected: boolean }> = []

      for (const change of changes) {
        if (change.type === 'position') {
          // React Flow emits { dragging: false } without position when drag ends
          positionChanges.push({ 
            id: change.id, 
            position: change.position, 
            dragging: change.dragging 
          })
        } else if (change.type === 'remove') {
          removeIds.push(change.id)
        } else if (change.type === 'dimensions') {
          dimensionChanges.push({
            id: change.id,
            dimensions: change.dimensions,
            resizing: change.resizing,
            origin: (change as NodeChange & { origin?: 'auto-size' | 'manual' }).origin,
          })
        } else if (change.type === 'select') {
          selectionChanges.push({ id: change.id, selected: change.selected })
        }
      }

      if (positionChanges.length) ops.applyNodePositionChanges(positionChanges)
      if (removeIds.length) {
        ops.applyNodeRemoveChanges(removeIds)
        // Ensure we clear selectedEdgeId if the currently selected edge was removed
        const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
        if (currentSelectedEdgeId) {
          const edgeStillExists = storeApi.getState().edges.some(e => e.id === currentSelectedEdgeId)
          if (!edgeStillExists) setSelectedEdgeId(null)
        }
      }
      if (dimensionChanges.length) ops.applyNodeDimensionChanges(dimensionChanges)
      if (selectionChanges.length) {
        // Multi-select via Shift is allowed natively by React Flow.
        // The selectionChanges array will contain all selections/deselections.
        ops.applyNodeSelectionChanges(selectionChanges)
        const anyNodeSelected = storeApi.getState().nodes.some(n => n.selected)
        if (anyNodeSelected) {
          const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
          if (currentSelectedEdgeId) {
            setSelectedEdgeId(null)
            ops.setSelectedEdgeInGraph(null)
          }
        }
      }
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          ops.deleteEdge(change.id)
          const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
          if (currentSelectedEdgeId === change.id) {
            setSelectedEdgeId(null)
          }
        } else if (change.type === 'select') {
          if (change.selected) {
            setSelectedEdgeId(change.id)
            ops.setSelectedEdgeInGraph(change.id)
          } else {
            // Only clear if this was the selected edge
            const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
            if (currentSelectedEdgeId === change.id) {
              setSelectedEdgeId(null)
              ops.setSelectedEdgeInGraph(null)
            } else {
              ops.setSelectedEdgeInGraph(currentSelectedEdgeId)
            }
            // Ensure the edge's internal data reflects the unselected state
          }
        }
      }
    },
    [ops, setSelectedEdgeId]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const graphUi = useGraphUiStore.getState()
      const source = connection.source ?? graphUi.connectingSourceId
      const target = graphUi.connectingTargetId
      if (!source || !target || source === target) return
      
      ops.deselectNode()
      ops.setSelectedEdgeInGraph(null)

      const edgeId = generateId('e-')
      ops.addEdge({ ...connection, source, target, targetHandle: null }, edgeId, defaultEdgeStyle).then(() => {
        ops.setSelectedEdgeInGraph(edgeId)
      })
      setSelectedEdgeId(edgeId)
    },
    [ops, defaultEdgeStyle, setSelectedEdgeId]
  )

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      logAction('节点:点击', 'useGraph', { nodeId: node.id, label: node.data.label })
      if (!event.shiftKey) {
        markPerformanceMetricStart(PERFORMANCE_METRICS.nodeSelect, node.id)
      }
      ops.selectNode(node.id, event.shiftKey)
      setSelectedEdgeId(null)
      ops.setSelectedEdgeInGraph(null)
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      ops.deselectNode()
      ops.setSelectedEdgeInGraph(edge.id)
      setSelectedEdgeId(edge.id)
    },
    [setSelectedEdgeId, ops]
  )

  const onPaneClick = useCallback(() => {
    ops.deselectNode()
    resetConnectTargetHighlight()
    ops.setSelectedEdgeInGraph(null)
    setSelectedEdgeId(null)
  }, [ops, setSelectedEdgeId, resetConnectTargetHighlight])

  const navigateToChildRoom = useCallback(async (childPath: string, childName: string) => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const absoluteChildPath = resolveRoomChildRef(dirPath || graphSession.kbPath, childPath)

    if (!absoluteChildPath || absoluteChildPath === dirPath) {
      return
    }
    if (navigationTargetRef.current === absoluteChildPath) {
      return
    }
    navigationTargetRef.current = absoluteChildPath
    if (navigationResetTimerRef.current !== null) {
      window.clearTimeout(navigationResetTimerRef.current)
    }

    try {
      const snapshot = dirPath ? ops.captureSaveSnapshot(dirPath) : null
      if (snapshot) await ops.saveSnapshot(snapshot)

      tabStore.getState().enterRoomInTab(tabId, {
        path: absoluteChildPath,
        kbPath: graphSession.kbPath || '',
        name: childName,
      })
      logAction('房间:钻入', 'useGraph', { roomPath: absoluteChildPath, roomName: childName, fromRoom: dirPath })
    } finally {
      if (navigationResetTimerRef.current !== null) {
        window.clearTimeout(navigationResetTimerRef.current)
      }
      navigationResetTimerRef.current = window.setTimeout(() => {
        if (navigationTargetRef.current === absoluteChildPath) {
          navigationTargetRef.current = ''
        }
        navigationResetTimerRef.current = null
      }, 800)
    }
  }, [getActiveGraphSession, tabId, ops])

  const onNodeContextMenu = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      setSelectedEdgeId(null)
      ops.setSelectedEdgeInGraph(null)
      markPerformanceMetricStart(PERFORMANCE_METRICS.nodeSelect, node.id)
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId]
  )

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null }) => {
    const graphUi = useGraphUiStore.getState()
    graphUi.setConnectingSourceId(params.nodeId ?? null)
    graphUi.setConnectingTargetId(null)
  }, [])

  const onConnectEnd = useCallback(() => {
    const graphUi = useGraphUiStore.getState()
    const source = graphUi.connectingSourceId
    const target = graphUi.connectingTargetId
    if (source && target && source !== target) {
      onConnect({ source, target, sourceHandle: null, targetHandle: null })
    }
    resetConnectTargetHighlight()
  }, [onConnect, resetConnectTargetHighlight])

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    navigateToChildRoom,
    onNodeContextMenu,
  }
}
