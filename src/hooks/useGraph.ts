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
import { useRightPanelStore } from '../stores/rightPanelStore'
import { tabStore } from '../stores/tabStore'
import { useStorage, type Store } from '../core/storage'
import { buildGraphOperations } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { useGraphRoomLoader } from './useGraph/useGraphRoomLoader'
import { useGraphStorageApi } from './useGraph/useGraphStorageApi'
import { useGraphPersistence } from './useGraph/useGraphPersistence'
import { useGraphStoreApi } from '../stores/graphStore'
import type { GraphState } from './useGraph/types'

export function useGraph(tabId: string) {
  const storeApi = useGraphStoreApi()
  const storage = useStorage() as Store

  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)
  const setRightPanelTab = useRightPanelStore((s) => s.setRightPanelTab)

  const isCreatingRef = useRef(false)

  const getActiveGraphSession = useCallback(() => tabStore.getState().getGraphSession(tabId), [tabId])

  const { loadRoom } = useGraphRoomLoader({
    storage,
    getActiveGraphSession,
    storeApi,
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
    setRightPanelTab,
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

  const { flushCurrentRoomSave } = useGraphPersistence({
    getActiveGraphSession,
    saveNow: ops.saveNow,
  })

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
    selectNode: ops.selectNode,
    deselectNode: ops.deselectNode,
    updateEdgeRelation: ops.updateEdgeRelation,
    updateEdgeStyle: ops.updateEdgeStyle,
    flushCurrentRoomSave,
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
    ops.selectNode,
    ops.deselectNode,
    ops.updateEdgeRelation,
    ops.updateEdgeStyle,
    flushCurrentRoomSave,
  ])
}
