/**
 * useGraph — Core graph logic hook
 *
 * Responsibilities:
 * - Load room graph data from filesystem (_graph.json)
 * - Persist layout changes (debounced)
 * - Handle room navigation (drill-in / drill-out)
 * - Coordinate React Flow event handlers
 *
 * Node/edge building is delegated to ./graphBuilder.ts
 * Node/edge CRUD operations are delegated to ./graphOperations.ts
 */
import { useCallback, useRef, useState } from 'react'
import type { Node, Edge, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { tabStore } from '../stores/tabStore'
import { useLayout } from './useLayout'
import { useStorage } from './useStorage'
import { useNavContext } from './useNavContext'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import type { KnowledgeNode, KnowledgeEdge, KnowledgeNodeData } from '../types'
import { buildMetaFromNodesEdges, buildNodes, buildEdges, generateId } from './useGraph/graphBuilder'
import { buildGraphOperations } from './useGraph/graphOperations'
import { applySearchHighlight } from './useGraph/search'
import { buildGraphNavigation } from './useGraph/navigation'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}

export function useGraph(tabId?: string) {
  const storage = useStorage()
  const { computeLayout } = useLayout()

  const enterRoom = useRoomStore((s) => s.enterRoom)
  const goBack = useRoomStore((s) => s.goBack)

  const selectNode = useAppStore((s) => s.selectNode)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const defaultEdgeStyle = useAppStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)

  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    loading: false,
    selectedNode: null,
  })

  const [isModified, setIsModified] = useState(false)

  // Node internal maps for O(1) access
  const nodesMapRef = useRef<Map<string, KnowledgeNode>>(new Map())
  const edgesMapRef = useRef<Map<string, KnowledgeEdge>>(new Map())
  // Refs for stable closure access to current nodes/edges
  const nodesRef = useRef<KnowledgeNode[]>([])
  const edgesRef = useRef<KnowledgeEdge[]>([])
  const isModifiedRef = useRef(false)
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)
  const isCreatingRef = useRef(false)

  // ===== Node/Edge helpers =====

  const rebuildMaps = useCallback((nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
    nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
    edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
  }, [])

  const updateSelectedNode = useCallback((nodes: KnowledgeNode[], nodeId: string | null) => {
    if (!nodeId) {
      setState((s) => ({ ...s, selectedNode: null }))
      return
    }
    const node = nodes.find((n) => n.id === nodeId) ?? null
    setState((s) => ({ ...s, selectedNode: node }))
  }, [])

  // ===== Dirty state callbacks =====

  const dirtyChangeCallbacksRef = useRef<Set<(isModified: boolean) => void>>(new Set())

  const setDirtyState = useCallback((next: boolean) => {
    if (isModifiedRef.current === next) return
    isModifiedRef.current = next
    setIsModified(next)
    dirtyChangeCallbacksRef.current.forEach((cb) => cb(next))
  }, [])

  const onDirtyChange = useCallback((callback: (isModified: boolean) => void) => {
    dirtyChangeCallbacksRef.current.add(callback)
    callback(isModifiedRef.current)
    return () => {
      dirtyChangeCallbacksRef.current.delete(callback)
    }
  }, [])

  // ===== Navigation helpers =====

  const getActiveSelectedNodeId = useCallback(() => {
    if (tabId) {
      return tabStore.getState().getTabSelectedNode(tabId)
    }
    return useAppStore.getState().selectedNodeId
  }, [tabId])

  const setActiveSelectedNodeId = useCallback((nodeId: string | null) => {
    if (tabId) {
      tabStore.getState().setTabSelectedNode(tabId, nodeId)
      return
    }

    if (nodeId === null) {
      clearSelection()
    } else {
      selectNode(nodeId)
    }
  }, [tabId, clearSelection, selectNode])

  const { getNavState } = useNavContext({ tabId })

  const getActiveNavState = useCallback(() => getNavState(), [getNavState])

  // ===== Load room =====

  const loadRoom = useCallback(
    async (dirPath: string, isCreating?: boolean) => {
      const requestSeq = ++loadRequestSeqRef.current
      setState((s) => ({ ...s, loading: true }))

      try {
        const meta = await storage.readLayout(dirPath)
        const kbPath = getActiveNavState().kbPath

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        // Abandon superseded requests before doing expensive I/O.
        // (requestSeq was incremented at the top; any newer loadRoom call
        // will have already incremented loadRequestSeqRef, so we can detect staleness.)
        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        // Build saved position map from child rooms' zoom/pan
        const savedPositions: Record<string, { x: number; y: number }> = {}
        if (meta.children) {
          const childEntries = Object.keys(meta.children)
          const positionResults = await Promise.allSettled(
            childEntries.map(async (childName) => {
              const childPath = dirPath ? `${dirPath}/${childName}` : childName
              const childMeta = await storage.readLayout(childPath)
              return { childPath, childMeta }
            })
          )
          for (const result of positionResults) {
            if (
              result.status === 'fulfilled' &&
              result.value.childMeta.zoom != null &&
              result.value.childMeta.pan != null
            ) {
              savedPositions[result.value.childPath] = {
                x: result.value.childMeta.pan.x,
                y: result.value.childMeta.pan.y,
              }
            }
          }
        }

        const nodes = await buildNodes(storage, dirPath, meta, savedPositions, kbPath)
        const edges = buildEdges(meta)

        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        setState({ nodes, edges, loading: false, selectedNode: null })
        rebuildMaps(nodes, edges)
        updateSelectedNode(nodes, null)
        nodesRef.current = nodes
        edgesRef.current = edges
        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          requestSeq,
        })

        setState({ nodes, edges, loading: false, selectedNode: null })
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [storage, getActiveNavState, rebuildMaps, updateSelectedNode]
  )

  // ===== Graph operations (CRUD) =====

  const ops = buildGraphOperations({
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveNavState,
    loadRoom,
    rebuildMaps,
    setState: setState as Parameters<typeof buildGraphOperations>[0]['setState'],
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    updateSelectedNode,
    setDirtyState,
    isCreatingRef,
    isModifiedRef,
  })

  // ===== Apply layout =====

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      const positions = await computeLayout(nodesRef.current, direction)
      if (Object.keys(positions).length === 0) return

      const updatedNodes = nodesRef.current.map((n) => {
        const pos = positions[n.id]
        return pos ? { ...n, position: pos } : n
      })

      rebuildMaps(updatedNodes, edgesRef.current)
      nodesRef.current = updatedNodes
      setState((s) => ({ ...s, nodes: updatedNodes }))
      logAction('布局:应用', 'useGraph', { direction, positionedCount: Object.keys(positions).length })

      const dirPath = getActiveNavState().roomPath
      if (dirPath) {
        await storage.saveLayout(dirPath, buildMetaFromNodesEdges(updatedNodes, edgesRef.current))
        setDirtyState(false)
      }
    },
    [computeLayout, rebuildMaps, getActiveNavState, storage, setDirtyState]
  )

  // ===== React Flow event handlers =====

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = []
      const removeIds: string[] = []
      const dimensionChanges: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined }> = []

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          positionChanges.push({ id: change.id, position: change.position })
        } else if (change.type === 'remove') {
          removeIds.push(change.id)
        } else if (change.type === 'dimensions') {
          dimensionChanges.push({ id: change.id, dimensions: change.dimensions })
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
      setSelectedEdgeId(null)
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      clearSelection()
      for (const current of edgesRef.current) {
        if (current.data?.selected && current.id !== edge.id) {
          ops.updateEdgeStyle(current.id, { selected: false })
        }
      }
      ops.updateEdgeStyle(edge.id, { selected: true })
      setSelectedEdgeId(edge.id)
      useAppStore.getState().setRightPanelTab('style')
    },
    [clearSelection, setSelectedEdgeId, ops, edgesRef]
  )

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
    const navState = getActiveNavState()
    const dirPath = navState.roomPath

    if (dirPath) {
      await ops.saveNow(dirPath)
    }

    // Resolve childPath to absolute path before storing — loadRoom needs absolute paths
    const absoluteChildPath = navState.kbPath && !childPath.startsWith(navState.kbPath)
      ? `${navState.kbPath}/${childPath}`
      : childPath

    if (tabId) {
      tabStore.getState().enterRoomInTab(tabId, {
        path: absoluteChildPath,
        kbPath: navState.kbPath || '',
        name: childName,
      })
    } else {
      enterRoom({ path: childPath, kbPath: navState.kbPath || '', name: childName })
    }
    logAction('房间:钻入', 'useGraph', { roomPath: childPath, roomName: childName, fromRoom: dirPath })
  }, [getActiveNavState, tabId, enterRoom, ops])

  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      if (!node.data.hasChildren) return
      await navigateToChildRoom(node.data.path, node.data.label)
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

  // ===== Room navigation =====

  const navigation = buildGraphNavigation({
    tabId,
    getActiveNavState,
    saveNow: ops.saveNow,
    loadRoom,
    clearSelection,
  })

  // ===== Search highlight =====

  const highlightSearch = useCallback((query: string) => {
    setState((prev) => ({
      ...prev,
      nodes: applySearchHighlight(prev.nodes, query),
    }))
  }, [])

  // ===== Persistence =====

  const flushCurrentRoomSave = useCallback(async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath || navState.kbPath || ''
    if (!dirPath) return
    await ops.saveNow(dirPath)
  }, [getActiveNavState, ops])

  // ===== Public API =====

  return {
    // State
    nodes: state.nodes,
    edges: state.edges,
    loading: state.loading,
    selectedNode: state.selectedNode,
    isModified,

    onDirtyChange,

    // Room lifecycle
    loadRoom,
    navigateBack: navigation.navigateBack,
    navigateToRoom: navigation.navigateToRoom,
    navigateToRoot: navigation.navigateToRoot,

    // React Flow handlers
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

    // Node operations (delegated to ops)
    createChildNode: ops.createChildNode,
    deleteChildNode: ops.deleteChildNode,
    renameNode: ops.renameNode,

    // Edge operations (delegated to ops)
    updateEdgeRelation: ops.updateEdgeRelation,
    updateEdgeStyle: ops.updateEdgeStyle,

    // Layout
    layoutNodes,

    // Search
    highlightSearch,

    // Persistence
    flushCurrentRoomSave,

    // Stable refs
    nodesRef,
    edgesRef,
    nodesMapRef,
    edgesMapRef,
    isCreatingRef,
  }
}
