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
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KnowledgeNode, KnowledgeEdge } from '../types'
import { useGraphUiStore } from '../stores/graphUiStore'
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
import { generateId } from './useGraph/graphBuilder'

export function useGraph(tabId: string) {
  const storeApi = useGraphStoreApi()
  const storage = useStorage() as Store

  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const setDefaultEdgeStyle = useGraphUiStore((s) => s.setDefaultEdgeStyle)
  const setDefaultNodeStyle = useGraphUiStore((s) => s.setDefaultNodeStyle)
  const setDefaultNodeSize = useGraphUiStore((s) => s.setDefaultNodeSize)
  const setNodeSizeLimits = useGraphUiStore((s) => s.setNodeSizeLimits)
  const setNodeBadgeSize = useGraphUiStore((s) => s.setNodeBadgeSize)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)

  const isCreatingRef = useRef(false)

  const getActiveGraphSession = useCallback(() => tabStore.getState().getGraphSession(tabId), [tabId])

  useEffect(() => {
    let active = true
    storage.readConfig().then((config) => {
      if (!active) return
      if (config.defaultEdgeStyle) setDefaultEdgeStyle(config.defaultEdgeStyle)
      if (config.defaultNodeStyle) setDefaultNodeStyle(config.defaultNodeStyle)
      if (config.defaultNodeSize) setDefaultNodeSize(config.defaultNodeSize)
      if (config.nodeSizeLimits) setNodeSizeLimits(config.nodeSizeLimits)
      if (typeof config.nodeBadgeSize === 'number') setNodeBadgeSize(config.nodeBadgeSize)
    })
    return () => {
      active = false
    }
  }, [storage, setDefaultEdgeStyle, setDefaultNodeSize, setDefaultNodeStyle, setNodeBadgeSize, setNodeSizeLimits])

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
    selectNode: ops.selectNode,
    deselectNode: ops.deselectNode,
    createEdge,
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
    ops.updateNodeStyle,
    ops.updateNodesStyle,
    ops.selectNode,
    ops.deselectNode,
    createEdge,
    ops.updateEdgeRelation,
    ops.updateEdgeStyle,
    flushCurrentRoomSave,
  ])
}
