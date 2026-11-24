import type { KnowledgeNodeStyle, NodeSizingMode } from '../../types'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { CANVAS_OPERATIONS } from '@/shared/observability/performanceContract'
import { PERFORMANCE_METRICS, newPerformanceTraceId, startPerformanceSpan } from '../../core/performance-log'
import { readCanvasScale, startCanvasSpan } from './canvasPerformanceContext'
import {
  applyNodeStylePatch,
  buildCreatedKnowledgeNode,
  clearNodeStyles,
  generateId,
} from './graphBuilder'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { createChildCardNode, renameCardNode } from '../../application/graph'
import type { StorageApi } from './graphOperations'
import type { GraphStoreApi } from '../../stores/graphStore'
import { NODE_STYLE_NUMBER_LIMITS, clampNumber } from '../../domain/style/styleConstraints'

function normalizeNodeStylePatch(style: KnowledgeNodeStyle): KnowledgeNodeStyle {
  const next: KnowledgeNodeStyle = {}
  if (Number.isFinite(style.headerFontSize)) next.headerFontSize = clampNumber(style.headerFontSize as number, NODE_STYLE_NUMBER_LIMITS.headerFontSize.min, NODE_STYLE_NUMBER_LIMITS.headerFontSize.max)
  if (Number.isFinite(style.bodyFontSize)) next.bodyFontSize = clampNumber(style.bodyFontSize as number, NODE_STYLE_NUMBER_LIMITS.bodyFontSize.min, NODE_STYLE_NUMBER_LIMITS.bodyFontSize.max)
  if (typeof style.headerColor === 'string') next.headerColor = style.headerColor.trim()
  if (typeof style.headerBackgroundColor === 'string') next.headerBackgroundColor = style.headerBackgroundColor.trim()
  if (style.headerFontWeight === 'normal' || style.headerFontWeight === 'bold') next.headerFontWeight = style.headerFontWeight
  if (style.headerFontStyle === 'normal' || style.headerFontStyle === 'italic') next.headerFontStyle = style.headerFontStyle
  if (typeof style.borderColor === 'string') next.borderColor = style.borderColor.trim()
  if (Number.isFinite(style.borderWidth)) next.borderWidth = clampNumber(style.borderWidth as number, NODE_STYLE_NUMBER_LIMITS.borderWidth.min, NODE_STYLE_NUMBER_LIMITS.borderWidth.max)
  if (Number.isFinite(style.borderRadius)) next.borderRadius = clampNumber(style.borderRadius as number, NODE_STYLE_NUMBER_LIMITS.borderRadius.min, NODE_STYLE_NUMBER_LIMITS.borderRadius.max)
  return next
}

export interface NodeCrudOperationsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  saveNow: (dirPath: string) => Promise<void>
  saveLater: (dirPath: string) => Promise<void>
  isCreatingRef: { current: boolean }
  /** 快路径必须确认当前房间已加载完成，否则保存快照会被 captureSaveSnapshot 丢弃。 */
  currentLoadedRoomPathRef: { current: string }
  /** 需要 temporal.pause()：删除不进 undo 历史，避免撤销出「目录已进回收站」的空壳节点。 */
  storeApi: GraphStoreApi
}

export function buildNodeCrudOperations(deps: NodeCrudOperationsDeps) {
  const {
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
    saveLater,
    isCreatingRef,
    currentLoadedRoomPathRef,
    storeApi,
  } = deps

  /**
   * 冷路径：把节点建进子房间（parentId 非空），或当前房间还没加载完成时。
   * 保留原来的「全量写盘 → 写子房间 layout → 重载房间」链，语义零变更；
   * 画布新建的热路径不会走到这里。
   */
  const createChildNodeViaReload = async (
    name: string,
    targetPath: string,
    reloadPath: string,
    position?: { x: number; y: number },
    options?: { editTitle?: boolean },
  ): Promise<string | null> => {
    const graphSession = getActiveGraphSession()
    const roomPath = graphSession.roomPath || null
    isCreatingRef.current = true
    const perfSpan = startPerformanceSpan(PERFORMANCE_METRICS.nodeCreate, {
      module: 'graphOperations',
      traceId: newPerformanceTraceId('graph'),
      contextKey: reloadPath,
      params: {
        strategy: 'reload',
        ...readCanvasScale(storeApi, { operation: CANVAS_OPERATIONS.create, roomPath: reloadPath }),
        roomPath,
      },
    })
    try {
      if (reloadPath) await saveNow(reloadPath)
      const cardId = generateId('card-')
      const defaultNodeSize = useGraphUiStore.getState().defaultNodeSize
      const result = await createChildCardNode(storage, {
        name,
        parentRef: targetPath,
        reloadRef: reloadPath,
        cardId,
        position,
        size: defaultNodeSize,
      })
      logAction('node.create', 'graphOperations', {
        nodeName: name,
        nodeId: cardId,
        parentPath: targetPath,
        newPath: result.newRef ?? null,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        reloadPath: reloadPath || null,
      })
      await loadRoom(reloadPath, true)
      isCreatingRef.current = false
      if (options?.editTitle) {
        const loadedStore = storeApi.getState()
        loadedStore.setNodes(loadedStore.nodes.map((node) => ({
          ...node,
          selected: node.id === cardId,
          data: node.id === cardId ? { ...node.data, titleEditRequested: true } : node.data,
        })))
      }
      perfSpan.end({ nodeId: cardId, strategy: 'reload' })
      return cardId
    } catch (e) {
      perfSpan.fail(e)
      isCreatingRef.current = false
      logger.catch('graphOperations', 'createChildNode', e)
      logAction('node.create_failed', 'graphOperations', {
        reason: 'exception',
        nodeName: name,
        parentPath: targetPath,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        error: (e as Error)?.message || String(e),
      })
      return null
    }
  }

  /**
   * 画布新建热路径：**同步**把节点插进内存，React 下一帧就画出来，不等待任何 IO。
   *
   * 旧实现为了 1 个新节点会串行跑「saveNow 全量写盘 → createChildCardNode 读+写整份
   * layout → loadRoom 重扫 N 个节点的目录摘要并重建全部节点 → 再全量 map 一遍设标题
   * 编辑态」，全 O(N) 且全部完成才更新 UI；节点 >400 时体感约半秒。现在落盘交给后台
   * debounced 保存：从内存构建完整 meta，与用户紧接着的改名 / 拖动按房间 key 合并成
   * 一次写盘，既不阻塞这一帧，也不会与 pending save 互相覆盖。
   */
  const createChildNodeOptimistic = async (
    name: string,
    roomPath: string,
    position?: { x: number; y: number },
    options?: { editTitle?: boolean },
  ): Promise<string | null> => {
    const graphSession = getActiveGraphSession()
    const cardId = generateId('card-')
    const store = storeApi.getState()
    if (store.nodesMap.has(cardId)) {
      logAction('node.create_failed', 'graphOperations', { reason: 'duplicate-id', nodeId: cardId })
      return null
    }
    const perfSpan = startPerformanceSpan(PERFORMANCE_METRICS.nodeCreate, {
      module: 'graphOperations',
      traceId: newPerformanceTraceId('graph'),
      contextKey: roomPath,
      params: {
        strategy: 'optimistic',
        ...readCanvasScale(storeApi, { operation: CANVAS_OPERATIONS.create, roomPath }),
        roomPath,
      },
    })
    try {
      const newNode = buildCreatedKnowledgeNode({
        roomPath,
        kbPath: graphSession.kbPath,
        cardId,
        name,
        position,
        size: useGraphUiStore.getState().defaultNodeSize,
        editTitle: options?.editTitle === true,
        fallbackIndex: store.nodes.length,
      })
      // 唯一一次同步写入：未变更节点保持原引用，reconcileMap 只补一条。
      store.setNodes([...store.nodes, newNode])
      logAction('node.create', 'graphOperations', {
        nodeName: name,
        nodeId: cardId,
        parentPath: roomPath,
        newPath: `${roomPath}/${cardId}`,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        reloadPath: roomPath,
        strategy: 'optimistic',
      })
      // 刻意不等待它：这一帧到此结束。错误由保存协调器保留 dirty 状态，
      // close guard / 后续 schedule 会重试；不引入特殊的回滚逻辑。
      void saveLater(roomPath).catch((cause) => {
        logger.catch('graphOperations', 'createChildNode:saveLater', cause)
      })
      perfSpan.end({ nodeId: cardId, strategy: 'optimistic' })
      return cardId
    } catch (e) {
      perfSpan.fail(e)
      logger.catch('graphOperations', 'createChildNode', e)
      logAction('node.create_failed', 'graphOperations', {
        reason: 'exception',
        nodeName: name,
        parentPath: roomPath,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        error: (e as Error)?.message || String(e),
      })
      return null
    }
  }

  const createChildNode = async (name: string, parentId?: string, position?: { x: number; y: number }, options?: { editTitle?: boolean }): Promise<string | null> => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const currentRoomPath = dirPath || graphSession.kbPath
    const targetPath = parentId ? resolveRoomChildRef(currentRoomPath, parentId) : currentRoomPath
    if (!targetPath) {
      logAction('node.create_failed', 'graphOperations', {
        reason: dirPath ? 'targetPath-empty' : 'not-inside-room',
        nodeName: name,
        parentId: parentId || null,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
      })
      return null
    }

    const reloadPath = currentRoomPath || getActiveGraphSession().kbPath || ''
    // 房间未加载完成时 captureSaveSnapshot 会丢弃快照，节点就会只停在内存里；
    // 这种情况下连同子房间分支一起退回旧链，保证磁盘一定被写入。
    if (!reloadPath || parentId || currentLoadedRoomPathRef.current !== reloadPath) {
      return createChildNodeViaReload(name, targetPath, reloadPath, position, options)
    }
    return createChildNodeOptimistic(name, reloadPath, position, options)
  }

  /**
   * 删除节点热路径：删 1 个节点不需要重读整房间。
   *
   * 旧链为了同步 UI 串行跑了「deleteCardNodeAndPruneGraph 直接改 store 内部 Map →
   * saveNow 全量写盘 → loadRoom 重扫 N 个节点的目录摘要、重建全部节点、
   * replaceGraphSession 全量 setNodes + 清空 undo 历史 + loading 遮罩 → 再全量 map
   * 清选中」。全 O(N) 且 await 完才更新 UI，节点 >400 时体感约半秒。
   *
   * 现在：唯一 IO 是把被删节点**自己的目录** rename 进回收站（局部、不扫描全库），
   * 成功后同步用 store 原语一次 filter 掉节点与关联边（React 同一批更新，
   * 未变更节点保持引用），落盘交给后台 debounced 保存按房间 key 合并。
   *
   * temporal.pause() 包住这次删除：目录已进回收站，若允许 Ctrl+Z 撤销会造出
   * 「节点回来了但文档/子房间没了」的空壳节点；同时保留此前的 undo 历史
   * （旧链的 replaceGraphSession 会把全部历史清空）。
   */
  const deleteChildNode = async (nodeId: string): Promise<boolean> => {
    const store = storeApi.getState()
    const nodeLabel = store.nodesMap.get(nodeId)?.data.label ?? nodeId
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    const perfSpan = startPerformanceSpan(PERFORMANCE_METRICS.nodeDelete, {
      module: 'graphOperations',
      traceId: newPerformanceTraceId('graph'),
      contextKey: currentRoomPath,
      params: {
        nodeId,
        cardPath,
        ...readCanvasScale(storeApi, { operation: CANVAS_OPERATIONS.delete, roomPath: currentRoomPath }),
      },
    })
    try {
      // 失败时内存与 UI 保持原样，语义与旧链一致；这里只等一次局部 rename IO。
      await storage.deleteCard(cardPath, nodeLabel)
      logAction('node.delete', 'graphOperations', {
        nodeId, label: nodeLabel, path: cardPath, strategy: 'optimistic',
      })

      const temporal = storeApi.temporal.getState()
      temporal.pause()
      try {
        const current = storeApi.getState()
        current.removeNodes([nodeId])
        current.removeEdgesByNodeIds([nodeId])
      } finally {
        temporal.resume()
      }

      // 后台合并落盘：快照从删除后的 store 构建，含被裁掉的关联边；
      // 与紧接着的其它编辑按房间 key 合并成一次写盘，不阻塞这一帧。
      if (currentRoomPath) {
        void saveLater(currentRoomPath).catch((cause) => {
          logger.catch('graphOperations', 'deleteChildNode:saveLater', cause)
        })
      }
      perfSpan.end({ nodeId, strategy: 'optimistic' })
      return true
    } catch (e) {
      perfSpan.fail(e)
      logger.catch('graphOperations', 'deleteChildNode', e)
      return false
    }
  }

  const renameNode = async (nodeId: string, newName: string): Promise<boolean> => {
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    try {
      await renameCardNode(storage, cardPath, newName)
      const store = storeApi.getState()
      const oldName = store.nodesMap.get(nodeId)?.data.label ?? nodeId
      logAction('node.rename', 'graphOperations', { nodeId, oldName, newName, path: cardPath })
      
      store.updateNode(nodeId, (node) => ({ ...node, data: { ...node.data, label: newName } }))

      if (currentRoomPath) await saveLater(currentRoomPath)
      return true
    } catch (e) {
      logger.catch('graphOperations', 'renameNode', e)
      return false
    }
  }

  const updateNodeStyle = async (nodeId: string, style: KnowledgeNodeStyle): Promise<void> => {
    await updateNodesStyle([nodeId], style)
  }

  const updateNodesStyle = async (nodeIds: string[], style: KnowledgeNodeStyle): Promise<void> => {
    const store = storeApi.getState()
    const patch = normalizeNodeStylePatch(style)
    // 一次遍历 + 一次 setNodes；旧实现逐个 updateNode 会触发 K 次全量 store 更新。
    const nextNodes = applyNodeStylePatch(store.nodes, nodeIds, patch)
    if (!nextNodes) return
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const perfSpan = startCanvasSpan(storeApi, {
      operation: CANVAS_OPERATIONS.batchStyle,
      roomPath: currentRoomPath,
      affectedCount: nodeIds.length,
      params: { trigger: 'set' },
    })
    store.setNodes(nextNodes)
    perfSpan.end()

    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('node.style_update', 'graphOperations', { nodeIds, style: patch })
  }

  const clearNodesStyle = async (nodeIds: string[]): Promise<void> => {
    const store = storeApi.getState()
    const nextNodes = clearNodeStyles(store.nodes, nodeIds)
    if (!nextNodes) return
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const perfSpan = startCanvasSpan(storeApi, {
      operation: CANVAS_OPERATIONS.batchStyle,
      roomPath: currentRoomPath,
      affectedCount: nodeIds.length,
      params: { trigger: 'clear' },
    })
    store.setNodes(nextNodes)
    perfSpan.end()

    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('node.style_update', 'graphOperations', { nodeIds })
  }

  const updateNodeSizingMode = async (
    nodeId: string,
    patch: Partial<{ widthMode: NodeSizingMode; heightMode: NodeSizingMode }>,
  ): Promise<void> => {
    const store = storeApi.getState()
    const node = store.nodesMap.get(nodeId)
    if (!node) return

    const nextWidthMode = patch.widthMode ?? node.data.widthMode
    const nextHeightMode = patch.heightMode ?? node.data.heightMode
    if (nextWidthMode === node.data.widthMode && nextHeightMode === node.data.heightMode) {
      return
    }

    store.updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      data: {
        ...currentNode.data,
        ...(patch.widthMode ? { widthMode: patch.widthMode } : {}),
        ...(patch.heightMode ? { heightMode: patch.heightMode } : {}),
      },
    }))

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('node.style_update', 'graphOperations', { nodeId, ...patch })
  }

  const updateNodeEmojis = async (nodeId: string, emojis: string[] | undefined): Promise<void> => {
    const store = storeApi.getState()
    const node = store.nodesMap.get(nodeId)
    if (!node) return

    store.updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      data: {
        ...currentNode.data,
        emojis,
      },
    }))

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('node.style_update', 'graphOperations', { nodeId, emojis })
  }

  return {
    createChildNode,
    deleteChildNode,
    renameNode,
    updateNodeStyle,
    updateNodesStyle,
    clearNodesStyle,
    updateNodeSizingMode,
    updateNodeEmojis,
  }
}
