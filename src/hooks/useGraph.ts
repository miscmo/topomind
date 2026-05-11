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
import { buildGraphOperations } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { useGraphDirtyState } from './useGraph/useGraphDirtyState'
import { useGraphRefs } from './useGraph/useGraphRefs'
import { useGraphLayout } from './useGraph/useGraphLayout'
import { useGraphRoomLoader } from './useGraph/useGraphRoomLoader'
import { useGraphStorageApi } from './useGraph/useGraphStorageApi'
import type { GraphState } from './useGraph/types'

export function useGraph(tabId: string) {
  const storage = useStorage() as Store
  const { computeLayout } = useLayout()

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

  const isCreatingRef = useRef(false)
  const { isModified, isModifiedRef, setDirtyState, onDirtyChange } = useGraphDirtyState()
  const setSelectedNodeState = useCallback((selectedNode: KnowledgeNode | null) => {
    setState((s) => ({ ...s, selectedNode }))
  }, [])
  const {
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    rebuildMaps,
    updateSelectedNode,
  } = useGraphRefs({
    setSelectedNode: setSelectedNodeState,
  })

  // ===== Navigation helpers =====

  const getActiveSelectedNodeId = useCallback(() => {
    return tabStore.getState().getTabSelectedNode(tabId)
  }, [tabId])

  const setActiveSelectedNodeId = useCallback((nodeId: string | null) => {
    tabStore.getState().setTabSelectedNode(tabId, nodeId)
  }, [tabId])

  const { getNavState } = useNavContext({ tabId })

  const getActiveNavState = useCallback(() => getNavState(), [getNavState])

  const { loadRoom } = useGraphRoomLoader({
    storage,
    getActiveNavState,
    rebuildMaps,
    updateSelectedNode,
    setState,
    nodesRef,
    edgesRef,
  })

  const storageApi = useGraphStorageApi(storage)

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

  const setNodesState = useCallback((nodes: KnowledgeNode[]) => {
    setState((s) => ({ ...s, nodes }))
  }, [])
  const { isLayouting, layoutNodes } = useGraphLayout({
    computeLayout,
    storage,
    getActiveNavState,
    nodesRef,
    edgesRef,
    rebuildMaps,
    setNodes: setNodesState,
    setDirtyState,
  })

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
