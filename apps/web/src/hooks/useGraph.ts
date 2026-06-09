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
import { useCallback, useMemo, useRef } from 'react'
import type { KnowledgeNode, KnowledgeEdge } from '../types'
import { useGraphUiStore } from '../stores/graphUiStore'
import { tabStore } from '../stores/tabs/tabStore'
import { createLocalDbGraphStorage } from '../core/localdb-graph'
import { buildGraphOperations } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { useGraphRoomLoader } from './useGraph/useGraphRoomLoader'
import { useGraphStorageApi } from './useGraph/useGraphStorageApi'
import { useGraphPersistence } from './useGraph/useGraphPersistence'
import { useGraphStoreApi } from '../stores/graphStore'
import type { GraphState } from './useGraph/types'
import { generateId } from './useGraph/graphBuilder'
import { useWorkspaceStore } from '../stores/workspaceStore'

function createUnavailableGraphStorage() {
  const unsupported = async (method: string) => {
    throw new Error(`云工作区未就绪，暂时无法执行图谱操作: ${method}`)
  }

  return {
    readLayout: () => unsupported('readLayout'),
    writeLayout: () => unsupported('writeLayout'),
    scheduleGraphSave: () => unsupported('scheduleGraphSave'),
    flushGraphSave: () => unsupported('flushGraphSave'),
    hasPendingGraphSave: () => false,
    countChildren: async () => 0,
    listTopoDocuments: async () => [],
    createCard: (_parentRef: string, _cardName: string, _cardId?: string) => unsupported('createCard'),
    deleteCard: () => unsupported('deleteCard'),
    renameCard: () => unsupported('renameCard'),
  }
}

export function useGraph(tabId: string) {
  const storeApi = useGraphStoreApi()
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const storage = useMemo(
    () => (currentWorkspaceId ? createLocalDbGraphStorage(currentWorkspaceId) : createUnavailableGraphStorage()),
    [currentWorkspaceId],
  )

  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)

  const isCreatingRef = useRef(false)
  const currentLoadedRoomRef = useRef('')

  const getActiveGraphSession = useCallback(() => tabStore.getState().getGraphSession(tabId), [tabId])

  const { loadRoom } = useGraphRoomLoader({
    storage,
    getActiveGraphSession,
    storeApi,
    currentLoadedRoomRef,
  })

  const storageApi = useGraphStorageApi(storage)

  // ===== Graph operations (CRUD) =====

  const ops = useMemo(
    () => buildGraphOperations({
      tabId,
      storage: storageApi,
      getActiveGraphSession,
      loadRoom,
      isCreatingRef,
      currentLoadedRoomRef,
      storeApi,
    }),
    [tabId, storageApi, getActiveGraphSession, loadRoom, storeApi]
  )

  // ===== React Flow event handlers =====

  const graphEvents = useGraphEventHandlers({
    tabId,
    ops,
    getActiveGraphSession,
    defaultEdgeStyle,
    setSelectedEdgeId,
    storeApi,
  })

  // ===== Room navigation =====

  const navigation = useMemo(
    () => buildGraphNavigation({
      tabId,
      getActiveGraphSession,
      saveNow: ops.saveNow,
      loadRoom,
      storeApi,
    }),
    [tabId, getActiveGraphSession, ops.saveNow, loadRoom, storeApi]
  )

  const graphPersistence = useGraphPersistence({
    getActiveGraphSession,
    hasPendingSave: ops.hasPendingSave,
    saveNow: ops.saveNow,
  })

  const createEdge = useCallback(async (source: string, target: string) => {
    if (!source || !target || source === target) return null
    const edgeId = generateId('e-')
    await ops.addEdge({ source, target, sourceHandle: null, targetHandle: null }, edgeId, defaultEdgeStyle)
    return edgeId
  }, [defaultEdgeStyle, ops])

  // ===== Public API =====

  return useMemo(() => ({
    loadRoom,
    navigateBack: navigation.navigateBack,
    navigateToRoom: navigation.navigateToRoom,
    navigateToRoot: navigation.navigateToRoot,
    onNodesChange: graphEvents.onNodesChange,
    onEdgesChange: graphEvents.onEdgesChange,
    onConnect: graphEvents.onConnect,
    onConnectStart: graphEvents.onConnectStart,
    onConnectEnd: graphEvents.onConnectEnd,
    onNodeClick: graphEvents.onNodeClick,
    onEdgeClick: graphEvents.onEdgeClick,
    onPaneClick: graphEvents.onPaneClick,
    navigateToChildRoom: graphEvents.navigateToChildRoom,
    onNodeContextMenu: graphEvents.onNodeContextMenu,
    createChildNode: ops.createChildNode,
    deleteChildNode: ops.deleteChildNode,
    renameNode: ops.renameNode,
    updateNodeStyle: ops.updateNodeStyle,
    updateNodesStyle: ops.updateNodesStyle,
    clearNodesStyle: ops.clearNodesStyle,
    selectNode: ops.selectNode,
    deselectNode: ops.deselectNode,
    createEdge,
    updateEdgeRelation: ops.updateEdgeRelation,
    updateEdgeStyle: ops.updateEdgeStyle,
    flushCurrentRoomSave: graphPersistence.flushCurrentRoomSave,
    hasPendingCurrentRoomSave: graphPersistence.hasPendingCurrentRoomSave,
    isCreatingRef,
  }), [
    loadRoom,
    navigation.navigateBack,
    navigation.navigateToRoom,
    navigation.navigateToRoot,
    graphEvents.onNodesChange,
    graphEvents.onEdgesChange,
    graphEvents.onConnect,
    graphEvents.onConnectStart,
    graphEvents.onConnectEnd,
    graphEvents.onNodeClick,
    graphEvents.onEdgeClick,
    graphEvents.onPaneClick,
    graphEvents.navigateToChildRoom,
    graphEvents.onNodeContextMenu,
    ops.createChildNode,
    ops.deleteChildNode,
    ops.renameNode,
    ops.updateNodeStyle,
    ops.updateNodesStyle,
    ops.clearNodesStyle,
    ops.selectNode,
    ops.deselectNode,
    createEdge,
    ops.updateEdgeRelation,
    ops.updateEdgeStyle,
    graphPersistence.flushCurrentRoomSave,
    graphPersistence.hasPendingCurrentRoomSave,
  ])
}
