/**
 * useGraph — graph orchestration hook
 *
 * Owns the public graph API for GraphContext and wires together:
 * - graph state and stable refs
 * - app store graph actions
 * - room loading
 * - graph persistence adapter
 * - node/edge operations
 * - React Flow event handlers
 * - room navigation
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { KnowledgeNode, KnowledgeEdge } from '../types'
import { useGraphUiStore } from '../stores/graphUiStore'
import { useRightPanelStore } from '../stores/rightPanelStore'
import { tabStore } from '../stores/tabStore'
import { useStorage, type Store } from '../core/storage'
import { buildGraphOperations } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { useGraphRefs } from './useGraph/useGraphRefs'
import { useGraphRoomLoader } from './useGraph/useGraphRoomLoader'
import { useGraphStorageApi } from './useGraph/useGraphStorageApi'
import type { GraphState } from './useGraph/types'
import { useGraphPersistence } from './useGraph/useGraphPersistence'
import { useGraphSelectionState } from './useGraph/useGraphSelectionState'

export function useGraph(tabId: string) {
  const storage = useStorage() as Store

  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)
  const setRightPanelTab = useRightPanelStore((s) => s.setRightPanelTab)

  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    loading: false,
    selectedNode: null,
  })

  const isCreatingRef = useRef(false)
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

  const {
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
  } = useGraphSelectionState(tabId)

  const getActiveGraphSession = useCallback(() => tabStore.getState().getGraphSession(tabId), [tabId])

  const { loadRoom } = useGraphRoomLoader({
    storage,
    getActiveGraphSession,
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
      getActiveGraphSession,
      loadRoom,
      rebuildMaps,
      setState: setState as Parameters<typeof buildGraphOperations>[0]['setState'],
      getActiveSelectedNodeId,
      setActiveSelectedNodeId,
      updateSelectedNode,
      isCreatingRef,
    }),
    [
      storageApi,
      getActiveGraphSession,
      loadRoom,
      rebuildMaps,
      getActiveSelectedNodeId,
      setActiveSelectedNodeId,
      updateSelectedNode,
    ]
  )

  // ===== React Flow event handlers =====

  const graphEvents = useGraphEventHandlers({
    tabId,
    ops,
    nodesRef,
    edgesRef,
    getActiveGraphSession,
    rebuildMaps,
    setState: setState as React.Dispatch<React.SetStateAction<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>>,
    defaultEdgeStyle,
    setSelectedEdgeId,
    setRightPanelTab,
  })

  // ===== Room navigation =====

  const navigation = useMemo(
    () => buildGraphNavigation({
      tabId,
      getActiveGraphSession,
      saveNow: ops.saveNow,
      loadRoom,
      deselectNode: ops.deselectNode,
    }),
    [tabId, getActiveGraphSession, ops.saveNow, ops.deselectNode, loadRoom]
  )


  const { flushCurrentRoomSave } = useGraphPersistence({
    getActiveGraphSession,
    saveNow: ops.saveNow,
  })

  // ===== Public API =====

  return {
    // State
    nodes: state.nodes,
    edges: state.edges,
    loading: state.loading,
    selectedNode: state.selectedNode,

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
    selectNode: ops.selectNode,
    deselectNode: ops.deselectNode,

    // Edge operations (delegated to ops)
    updateEdgeRelation: ops.updateEdgeRelation,
    updateEdgeStyle: ops.updateEdgeStyle,

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
