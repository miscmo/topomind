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
import { useGraphUiStore } from '../stores/graphUiStore'
import { tabStore } from '../stores/tabs/tabStore'
import { useStorage, type Store } from '../core/storage'
import { buildGraphOperations } from './useGraph/graphOperations'
import { buildGraphNavigation } from './useGraph/navigation'
import { useGraphEventHandlers } from './useGraph/graphEventHandlers'
import { useGraphRoomLoader } from './useGraph/useGraphRoomLoader'
import { useGraphStorageApi } from './useGraph/useGraphStorageApi'
import { useGraphPersistence } from './useGraph/useGraphPersistence'
import { useGraphStoreApi } from '../stores/graphStore'

import { generateId } from './useGraph/graphBuilder'
import { DEFAULT_EDGE_RELATION_ID } from '../domain/graph/edgeRelations'
import { filterReadOnlyEdgeChanges, filterReadOnlyNodeChanges } from '../domain/graph/canvasReadOnly'
import { isCanvasReadOnly } from '../stores/canvasReadOnlyStore'

/**
 * 【画布只读闸门 2026-11-11】所有编辑方法在返回给页面之前统一过这一层。
 * 放在 useGraph 而不是 GraphContext，是因为右键菜单 / 页面级 actions 在 Provider
 * **外面**也持有同一个 graph 对象；只包 Provider 会漏掉「新建节点 / 删除 / 跨房间移动」。
 * 只读时返回与原方法同类型的空结果，调用方无需判空、也不会误以为操作成功。
 */
function guardCanvasEdit<A extends unknown[], R>(
  scope: string,
  fn: (...args: A) => R,
  blocked: () => R,
): (...args: A) => R {
  return (...args: A): R => (isCanvasReadOnly(scope) ? blocked() : fn(...args))
}

export function useGraph(tabId: string) {
  const storeApi = useGraphStoreApi()
  const storage = useStorage() as Store

  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)

  const isCreatingRef = useRef(false)
  const currentLoadedRoomPathRef = useRef('')

  const getActiveGraphSession = useCallback(() => tabStore.getState().getGraphSession(tabId), [tabId])

  const { loadRoom } = useGraphRoomLoader({
    storage,
    getActiveGraphSession,
    storeApi,
    currentLoadedRoomPathRef,
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
      currentLoadedRoomPathRef,
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
      captureSaveSnapshot: ops.captureSaveSnapshot,
      saveSnapshot: ops.saveSnapshot,
      loadRoom,
      storeApi,
    }),
    [tabId, getActiveGraphSession, ops.captureSaveSnapshot, ops.saveSnapshot, loadRoom, storeApi]
  )

  const { flushCurrentRoomSave, hasPendingCurrentRoomSave } = useGraphPersistence({
    getActiveGraphSession,
    saveNow: ops.saveNow,
    hasPendingSave: storageApi.hasPendingGraphSave,
  })

  const createEdge = useCallback(async (source: string, target: string) => {
    if (!source || !target || source === target) return null
    const edgeId = generateId('e-')
    // Tab 快捷键创建的是「右侧兄弟节点」，语义上恒为弱关联、不进层级树。
    // 用户手动画出来的连线才走必选关系浮层（见 graphEventHandlers.onConnect）。
    const created = await ops.addEdge(
      { source, target, sourceHandle: null, targetHandle: null },
      edgeId,
      defaultEdgeStyle,
      DEFAULT_EDGE_RELATION_ID,
    )
    return created ? edgeId : null
  }, [defaultEdgeStyle, ops])

  // ===== Public API =====
  // 只读闸门只包「写」方法；导航、选中、点击、保存、ref 一律放行，
  // 保证远景下仍能查看节点 / 右栏信息、进出房间、正常关闭页面保存。
  return useMemo(() => {
    const edit = <A extends unknown[], R>(fn: (...args: A) => R, blocked: () => R) =>
      guardCanvasEdit(tabId, fn, blocked)
    const noop = (): void => {}
    const noAsync = (): Promise<void> => Promise.resolve()
    const noId = (): Promise<string | null> => Promise.resolve(null)
    const noResult = (): Promise<boolean> => Promise.resolve(false)
    return {
    loadRoom,
    navigateBack: navigation.navigateBack,
    navigateToRoom: navigation.navigateToRoom,
    navigateToRoot: navigation.navigateToRoot,
    // 只读时只放行 select / dimensions（查看态 + xyflow 测量 + auto-size），
    // position / remove / add / replace 一律在进 store 之前被过滤掉。
    onNodesChange: (changes: Parameters<typeof graphEvents.onNodesChange>[0]) =>
      graphEvents.onNodesChange(isCanvasReadOnly(tabId) ? filterReadOnlyNodeChanges(changes) : changes),
    onEdgesChange: (changes: Parameters<typeof graphEvents.onEdgesChange>[0]) =>
      graphEvents.onEdgesChange(isCanvasReadOnly(tabId) ? filterReadOnlyEdgeChanges(changes) : changes),
    onConnect: edit(graphEvents.onConnect, noop),
    onConnectStart: edit(graphEvents.onConnectStart, noop),
    onConnectEnd: edit(graphEvents.onConnectEnd, noop),
    onNodeClick: graphEvents.onNodeClick,
    onEdgeClick: graphEvents.onEdgeClick,
    selectEdge: graphEvents.selectEdge,
    onPaneClick: graphEvents.onPaneClick,
    navigateToChildRoom: graphEvents.navigateToChildRoom,
    onNodeContextMenu: graphEvents.onNodeContextMenu,
    createChildNode: edit(ops.createChildNode, noId),
    deleteChildNode: edit(ops.deleteChildNode, noResult),
    renameNode: edit(ops.renameNode, noResult),
    updateNodeStyle: edit(ops.updateNodeStyle, noAsync),
    updateNodesStyle: edit(ops.updateNodesStyle, noAsync),
    clearNodesStyle: edit(ops.clearNodesStyle, noAsync),
    updateNodeSizingMode: edit(ops.updateNodeSizingMode, noAsync),
    updateNodeEmojis: edit(ops.updateNodeEmojis, noAsync),
    selectNode: ops.selectNode,
    deselectNode: ops.deselectNode,
    createEdge: edit(createEdge, noId),
    // 【多选镜像 2026-11-11】与其余写操作一样过唯一闸门：缩小/有隐藏节点时禁写。
    flipSelectionHorizontally: edit(ops.flipSelectionHorizontally, noResult),
    updateEdgeRelation: edit(ops.updateEdgeRelation, noResult),
    updateEdgeStyle: edit(ops.updateEdgeStyle, noAsync),
    updateEdgeAnchor: edit(ops.updateEdgeAnchor, noAsync),
    deleteEdge: edit(ops.deleteEdge, noResult),
    flushCurrentRoomSave,
    hasPendingCurrentRoomSave,
    isCreatingRef,
    }
  }, [
    tabId,
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
    graphEvents.selectEdge,
    graphEvents.onPaneClick,
    graphEvents.navigateToChildRoom,
    graphEvents.onNodeContextMenu,
    ops.createChildNode,
    ops.deleteChildNode,
    ops.renameNode,
    ops.updateNodeStyle,
    ops.updateNodesStyle,
    ops.clearNodesStyle,
    ops.updateNodeSizingMode,
    ops.updateNodeEmojis,
    ops.selectNode,
    ops.deselectNode,
    createEdge,
    ops.flipSelectionHorizontally,
    ops.updateEdgeRelation,
    ops.updateEdgeStyle,
    ops.updateEdgeAnchor,
    ops.deleteEdge,
    flushCurrentRoomSave,
    hasPendingCurrentRoomSave,
  ])
}
