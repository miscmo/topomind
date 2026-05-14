import { useCallback } from 'react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { tabStore } from '../../stores/tabStore'
import { logAction } from '../../core/log-backend'
import type { KnowledgeNodeData } from '../../types'
import type { RightPanelTab } from '../../stores/uiStoreTypes'
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
  setRightPanelTab: (tab: RightPanelTab) => void
  storeApi: StoreApi<GraphState>
}

export function useGraphEventHandlers(deps: GraphEventHandlerDeps) {
  const {
    tabId,
    ops,
    getActiveGraphSession,
    defaultEdgeStyle,
    setSelectedEdgeId,
    setRightPanelTab,
    storeApi,
  } = deps

  const resetConnectTargetHighlight = useCallback(() => {
    let changed = false
    const store = storeApi.getState()
    const nextNodes = store.nodes.map((node) => {
      if (!node.data.connectTarget) return node
      changed = true
      return { ...node, data: { ...node.data, connectTarget: false } }
    })
    if (!changed) return
    store.setNodes(nextNodes)
  }, [storeApi])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = []
      const removeIds: string[] = []
      const dimensionChanges: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean }> = []
      const selectionChanges: Array<{ id: string; selected: boolean }> = []

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          positionChanges.push({ id: change.id, position: change.position })
        } else if (change.type === 'remove') {
          removeIds.push(change.id)
        } else if (change.type === 'dimensions') {
          dimensionChanges.push({ id: change.id, dimensions: change.dimensions, resizing: change.resizing })
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
        // Only allow selecting a single node at a time
        const selectedNodeChanges = selectionChanges.filter(c => c.selected)
        if (selectedNodeChanges.length > 1) {
          // Keep only the last selected node, deselect others
          const lastSelectedId = selectedNodeChanges[selectedNodeChanges.length - 1].id
          selectionChanges.forEach(c => {
            if (c.id !== lastSelectedId) c.selected = false
          })
        }

        ops.applyNodeSelectionChanges(selectionChanges)
        const anyNodeSelected = selectionChanges.some(c => c.selected)
        if (anyNodeSelected) {
          const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
          if (currentSelectedEdgeId) {
            setSelectedEdgeId(null)
            ops.updateEdgeStyle(currentSelectedEdgeId, { selected: false })
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
          } else {
            // Only clear if this was the selected edge
            const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
            if (currentSelectedEdgeId === change.id) {
              setSelectedEdgeId(null)
            }
            // Ensure the edge's internal data reflects the unselected state
            ops.updateEdgeStyle(change.id, { selected: false })
          }
        }
      }
    },
    [ops, setSelectedEdgeId]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      
      ops.deselectNode()
      const store = storeApi.getState()
      for (const current of store.edges) {
        if (current.data?.selected) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }

      const edgeId = generateId('e-')
      ops.addEdge(connection, edgeId, defaultEdgeStyle).then(() => {
        ops.updateEdgeStyle(edgeId, { selected: true })
      })
      setSelectedEdgeId(edgeId)
      setRightPanelTab('style')
    },
    [ops, defaultEdgeStyle, setSelectedEdgeId, storeApi, setRightPanelTab]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      logAction('节点:点击', 'useGraph', { node })
      setSelectedEdgeId(null)
      const store = storeApi.getState()
      for (const current of store.edges) {
        if (current.data?.selected) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId, storeApi]
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      ops.deselectNode()
      const store = storeApi.getState()
      for (const current of store.edges) {
        if (current.data?.selected && current.id !== edge.id) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }
      ops.updateEdgeStyle(edge.id, { selected: true })
      setSelectedEdgeId(edge.id)
      setRightPanelTab('style')
    },
    [setSelectedEdgeId, setRightPanelTab, ops, storeApi]
  )

  const onPaneClick = useCallback(() => {
    ops.deselectNode()
    resetConnectTargetHighlight()
    const store = storeApi.getState()
    for (const current of store.edges) {
      if (current.data?.selected) {
        ops.updateEdgeStyle(current.id, { selected: false })
      }
    }
    setSelectedEdgeId(null)
  }, [ops, setSelectedEdgeId, resetConnectTargetHighlight, storeApi])

  const navigateToChildRoom = useCallback(async (childPath: string, childName: string) => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath

    if (dirPath) {
      await ops.saveNow(dirPath)
    }

    const absoluteChildPath = resolveRoomChildRef(dirPath || graphSession.kbPath, childPath)

    tabStore.getState().enterRoomInTab(tabId, {
      path: absoluteChildPath,
      kbPath: graphSession.kbPath || '',
      name: childName,
    })
    logAction('房间:钻入', 'useGraph', { roomPath: childPath, roomName: childName, fromRoom: dirPath })
  }, [getActiveGraphSession, tabId, ops])

  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      if (!node.data.childCount) return
      await navigateToChildRoom(node.id, node.data.label)
    },
    [navigateToChildRoom]
  )

  const onNodeContextMenu = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      setSelectedEdgeId(null)
      const store = storeApi.getState()
      for (const current of store.edges) {
        if (current.data?.selected) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId, storeApi]
  )

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null }) => {
    const sourceId = params.nodeId
    let changed = false
    const store = storeApi.getState()
    const nextNodes = store.nodes.map((node) => {
      const shouldHighlight = !!sourceId && node.id !== sourceId
      if (node.data.connectTarget === shouldHighlight) return node
      changed = true
      return {
        ...node,
        data: {
          ...node.data,
          connectTarget: shouldHighlight,
        },
      }
    })
    if (!changed) return
    store.setNodes(nextNodes)
  }, [storeApi])

  const onConnectEnd = useCallback(() => {
    resetConnectTargetHighlight()
  }, [resetConnectTargetHighlight])

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onNodeDoubleClick,
    onNodeContextMenu,
  }
}
