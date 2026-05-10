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
import { useCallback, useMemo, useRef, useState } from 'react'
import type { KnowledgeNode, KnowledgeEdge } from '../types'
import { useAppStore } from '../stores/appStore'
import { tabStore } from '../stores/tabStore'
import { useLayout } from './useLayout'
import { useStorage } from './useStorage'
import { useNavContext } from './useNavContext'
import type { Store } from '../core/storage'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import { buildMetaFromNodesEdges } from './useGraph/graphBuilder'
import { buildGraphOperations, type StorageApi } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { loadRoomGraph } from './useGraph/roomLoader'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}

export function useGraph(tabId: string) {
  const storage = useStorage() as Store
  const { computeLayout } = useLayout()

  const selectNode = useAppStore((s) => s.selectNode)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const defaultEdgeStyle = useAppStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)

  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    loading: false,
    selectedNode: null,
  })

  const [isModified, setIsModified] = useState(false)
  const [isLayouting, setIsLayouting] = useState(false)

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
  const isLayoutingRef = useRef(false)

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
    return tabStore.getState().getTabSelectedNode(tabId)
  }, [tabId])

  const setActiveSelectedNodeId = useCallback((nodeId: string | null) => {
    tabStore.getState().setTabSelectedNode(tabId, nodeId)
  }, [tabId, clearSelection, selectNode])

  const { getNavState } = useNavContext({ tabId })

  const getActiveNavState = useCallback(() => getNavState(), [getNavState])

  // ===== Load room =====

  const loadRoom = useCallback(
    async (dirPath: string, isCreating?: boolean) => {
      const requestSeq = ++loadRequestSeqRef.current
      setState((s) => ({ ...s, loading: true }))

      try {
        const kbPath = getActiveNavState().kbPath
        const loaded = await loadRoomGraph(storage, dirPath, kbPath)

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        // Abandon superseded requests before doing expensive I/O.
        // (requestSeq was incremented at the top; any newer loadRoom call
        // will have already incremented loadRequestSeqRef, so we can detect staleness.)
        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        setState({ nodes: loaded.nodes, edges: loaded.edges, loading: false, selectedNode: null })
        rebuildMaps(loaded.nodes, loaded.edges)
        updateSelectedNode(loaded.nodes, null)
        nodesRef.current = loaded.nodes
        edgesRef.current = loaded.edges
        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
        })
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [storage, getActiveNavState, rebuildMaps, updateSelectedNode]
  )

  // Storage adapter compatible with the minimal interface graphOperations expects
  const storageApi = useMemo(() => ({
    createCard: storage.createCard.bind(storage),
    deleteCard: storage.deleteCard.bind(storage),
    renameCard: storage.renameCard.bind(storage),
    saveGraphDebounced: storage.saveGraphDebounced.bind(storage) as StorageApi['saveGraphDebounced'],
    flushGraphSave: storage.flushGraphSave.bind(storage) as StorageApi['flushGraphSave'],
    readLayout: storage.readLayout.bind(storage) as StorageApi['readLayout'],
    writeLayout: storage.writeLayout.bind(storage) as StorageApi['writeLayout'],
  }), [storage])

  // ===== Graph operations (CRUD) =====

  const ops = useMemo(
    () => buildGraphOperations({
      storage: storageApi,
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
    }),
    [
      storageApi,
      getActiveNavState,
      loadRoom,
      rebuildMaps,
      getActiveSelectedNodeId,
      setActiveSelectedNodeId,
      updateSelectedNode,
      setDirtyState,
    ]
  )

  // ===== Apply layout =====

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      if (isLayoutingRef.current) {
        logAction('布局:跳过重复请求', 'useGraph', { direction })
        return
      }

      isLayoutingRef.current = true
      setIsLayouting(true)

      try {
        const navStateBeforeLayout = getActiveNavState()
        const roomPathBeforeLayout = navStateBeforeLayout.roomPath
        const nodesBeforeLayout = nodesRef.current
        const positions = await computeLayout(nodesBeforeLayout, direction)
        if (Object.keys(positions).length === 0) return

        if (getActiveNavState().roomPath !== roomPathBeforeLayout || nodesRef.current !== nodesBeforeLayout) {
          logAction('布局:丢弃过期结果', 'useGraph', { direction, roomPath: roomPathBeforeLayout })
          return
        }

        const updatedNodes = nodesBeforeLayout.map((n) => {
          const pos = positions[n.id]
          return pos ? { ...n, position: pos } : n
        })

        rebuildMaps(updatedNodes, edgesRef.current)
        nodesRef.current = updatedNodes
        setState((s) => ({ ...s, nodes: updatedNodes }))
        logAction('布局:应用', 'useGraph', { direction, positionedCount: Object.keys(positions).length })

        if (roomPathBeforeLayout) {
          await storage.flushGraphSave(
            roomPathBeforeLayout,
            () => buildMetaFromNodesEdges(updatedNodes, edgesRef.current),
            () => setDirtyState(false)
          )
        }
      } finally {
        isLayoutingRef.current = false
        setIsLayouting(false)
      }
    },
    [computeLayout, rebuildMaps, getActiveNavState, storage, setDirtyState]
  )

  // ===== React Flow event handlers =====

  const graphEvents = useGraphEventHandlers({
    tabId,
    ops,
    nodesRef,
    edgesRef,
    getActiveNavState,
    rebuildMaps,
    setState: setState as React.Dispatch<React.SetStateAction<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>>,
    clearSelection,
    defaultEdgeStyle,
    setSelectedEdgeId,
    setRightPanelTab,
  })

  // ===== Room navigation =====

  const navigation = useMemo(
    () => buildGraphNavigation({
      tabId,
      getActiveNavState,
      saveNow: ops.saveNow,
      loadRoom,
      clearSelection,
    }),
    [tabId, getActiveNavState, ops.saveNow, loadRoom, clearSelection]
  )


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
    isLayouting,

    onDirtyChange,

    // Room lifecycle
    loadRoom,
    navigateBack: navigation.navigateBack,
    navigateToRoom: navigation.navigateToRoom,
    navigateToRoot: navigation.navigateToRoot,

    // React Flow handlers
    onNodesChange: graphEvents.onNodesChange,
    onEdgesChange: graphEvents.onEdgesChange,
    onConnect: graphEvents.onConnect,
    onConnectStart: graphEvents.onConnectStart,
    onConnectEnd: graphEvents.onConnectEnd,
    onNodeClick: graphEvents.onNodeClick,
    onEdgeClick: graphEvents.onEdgeClick,
    onPaneClick: graphEvents.onPaneClick,
    onNodeDoubleClick: graphEvents.onNodeDoubleClick,
    onNodeContextMenu: graphEvents.onNodeContextMenu,

    // Node operations (delegated to ops)
    createChildNode: ops.createChildNode,
    deleteChildNode: ops.deleteChildNode,
    renameNode: ops.renameNode,

    // Edge operations (delegated to ops)
    updateEdgeRelation: ops.updateEdgeRelation,
    updateEdgeStyle: ops.updateEdgeStyle,

    // Layout
    layoutNodes,


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
