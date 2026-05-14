import { useCallback } from 'react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { tabStore } from '../../stores/tabStore'
import { logAction } from '../../core/log-backend'
import type { KnowledgeEdge, KnowledgeNode, KnowledgeNodeData } from '../../types'
import type { RightPanelTab } from '../../stores/uiStoreTypes'
import { generateId } from './graphBuilder'
import type { GraphOperations } from './graphOperations'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'

export interface GraphEventHandlerDeps {
  tabId: string
  ops: GraphOperations
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setState: React.Dispatch<React.SetStateAction<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>>
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  setSelectedEdgeId: (edgeId: string | null) => void
  setRightPanelTab: (tab: RightPanelTab) => void
}

export function useGraphEventHandlers(deps: GraphEventHandlerDeps) {
  const {
    tabId,
    ops,
    nodesRef,
    edgesRef,
    getActiveGraphSession,
    rebuildMaps,
    setState,
    defaultEdgeStyle,
    setSelectedEdgeId,
    setRightPanelTab,
  } = deps

  const resetConnectTargetHighlight = useCallback(() => {
    let changed = false
    const nextNodes = nodesRef.current.map((node) => {
      if (!node.data.connectTarget) return node
      changed = true
      return { ...node, data: { ...node.data, connectTarget: false } }
    })
    if (!changed) return
    nodesRef.current = nextNodes
    rebuildMaps(nextNodes, edgesRef.current)
    setState((prev) => ({ ...prev, nodes: nextNodes }))
  }, [rebuildMaps, setState, nodesRef, edgesRef])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = []
      const removeIds: string[] = []
      const dimensionChanges: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean }> = []

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          positionChanges.push({ id: change.id, position: change.position })
        } else if (change.type === 'remove') {
          removeIds.push(change.id)
        } else if (change.type === 'dimensions') {
          dimensionChanges.push({ id: change.id, dimensions: change.dimensions, resizing: change.resizing })
        }
      }

      if (positionChanges.length) ops.applyNodePositionChanges(positionChanges)
      if (removeIds.length) ops.applyNodeRemoveChanges(removeIds)
      if (dimensionChanges.length) ops.applyNodeDimensionChanges(dimensionChanges)
    },
    [ops]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          ops.deleteEdge(change.id)
        }
      }
    },
    [ops]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const edgeId = generateId('e-')
      ops.addEdge(connection, edgeId, defaultEdgeStyle)
      setSelectedEdgeId(edgeId)
    },
    [ops, defaultEdgeStyle, setSelectedEdgeId]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      logAction('节点:点击', 'useGraph', { node })
      setSelectedEdgeId(null)
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      ops.deselectNode()
      for (const current of edgesRef.current) {
        if (current.data?.selected && current.id !== edge.id) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }
      ops.updateEdgeStyle(edge.id, { selected: true })
      setSelectedEdgeId(edge.id)
      setRightPanelTab('style')
    },
    [setSelectedEdgeId, setRightPanelTab, ops, edgesRef]
  )

  const onPaneClick = useCallback(() => {
    ops.deselectNode()
    resetConnectTargetHighlight()
    for (const current of edgesRef.current) {
      if (current.data?.selected) {
        ops.updateEdgeStyle(current.id, { selected: false })
      }
    }
    setSelectedEdgeId(null)
  }, [ops, setSelectedEdgeId, edgesRef, resetConnectTargetHighlight])

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
      ops.selectNode(node.id)
    },
    [ops]
  )

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null }) => {
    const sourceId = params.nodeId
    let changed = false
    const nextNodes = nodesRef.current.map((node) => {
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
    nodesRef.current = nextNodes
    rebuildMaps(nextNodes, edgesRef.current)
    setState((prev) => ({ ...prev, nodes: nextNodes }))
  }, [nodesRef, edgesRef, rebuildMaps, setState])

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
