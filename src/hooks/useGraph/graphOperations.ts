/**
 * graphOperations — Node/edge CRUD and mutation operations for the graph
 *
 * Extracted from useGraph.ts to keep the hook focused on coordination.
 * All functions here deal with pure state transformations and storage I/O.
 */
import type { GraphMeta } from '../../core/storage'
import { PERFORMANCE_METRICS, startPerformanceSpan } from '../../core/performance-log'
import { CANVAS_OPERATIONS } from '@/shared/observability/performanceContract'
import { readCanvasScale } from './canvasPerformanceContext'
import { buildMetaFromNodesEdges } from './graphBuilder'
import { buildNodeTreeOperations } from './nodeTreeOperations'
import { buildNodeCrudOperations } from './nodeCrudOperations'
import { buildEdgeOperations } from './edgeOperations'
import { buildNodeChangeOperations } from './nodeChangeOperations'
import { buildSelectionOperations } from './selectionOperations'
import { buildSelectionMirrorOperations } from './selectionMirrorOperations'
import { buildSelectionSubtreeOperations } from './selectionSubtreeOperations'
import type { GraphState, GraphStoreApi } from '../../stores/graphStore'

import type { GraphSession } from '../../stores/tabs/tabStore'
import { useGraphUiStore } from '../../stores/graphUiStore'

export interface StorageApi {
  saveGraphDebounced: (dirPath: string, buildMeta: () => GraphMeta, onSaved: (() => void) | undefined) => Promise<void>
  hasPendingGraphSave: (dirPath: string) => boolean
  deleteCard: (cardPath: string, label?: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  flushGraphSave: (dirPath: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => Promise<void>
  readLayout: (dirPath: string) => Promise<GraphMeta>
  writeLayout: (dirPath: string, meta: GraphMeta) => Promise<void>
}

export interface GraphOpsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => GraphSession
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  isCreatingRef: { current: boolean }
  currentLoadedRoomPathRef: { current: string }
  storeApi: GraphStoreApi
}

export interface GraphSaveSnapshot {
  dirPath: string
  meta: GraphMeta
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    isCreatingRef,
    currentLoadedRoomPathRef,
    storeApi,
  } = deps

  // ===== Internal helpers =====

  const buildGraphMetaSnapshot = (store: GraphState, dirPath: string): GraphMeta => {
    // 这一步是全量 O(N+E) 序列化：SaveCoordinator 只合并写盘，不合并构建。
    // 单独立一个指标，才能把「大图上变慢」与「界面操作变慢」分开归因。
    const scale = readCanvasScale(storeApi, {
      operation: CANVAS_OPERATIONS.metaBuild,
      roomPath: dirPath,
    })
    const span = startPerformanceSpan(PERFORMANCE_METRICS.graphMetaBuild, {
      module: 'graphOperations',
      contextKey: dirPath,
      params: { ...scale },
    })
    try {
      const meta = buildMetaFromNodesEdges(
        Array.from(store.nodesMap.values()),
        Array.from(store.edgesMap.values()),
        { zoom: store.viewport.zoom, pan: { x: store.viewport.x, y: store.viewport.y } },
      )
      span.end({ metaNodeCount: Object.keys(meta.nodes ?? {}).length })
      return meta
    } catch (error) {
      span.fail(error)
      throw error
    }
  }

  const captureSaveSnapshot = (dirPath: string): GraphSaveSnapshot | null => {
    if (!dirPath) return null
    if (currentLoadedRoomPathRef.current !== dirPath) {
      return null
    }
    return {
      dirPath,
      meta: buildGraphMetaSnapshot(storeApi.getState(), dirPath),
    }
  }

  const saveSnapshot = async (snapshot: GraphSaveSnapshot | null) => {
    if (!snapshot?.dirPath) return
    await storage.flushGraphSave(snapshot.dirPath, () => snapshot.meta, undefined)
  }

  const scheduleSaveSnapshot = async (snapshot: GraphSaveSnapshot | null) => {
    if (!snapshot?.dirPath) return
    await storage.saveGraphDebounced(snapshot.dirPath, () => snapshot.meta, undefined)
  }

  const saveNow = async (dirPath: string) => {
    await saveSnapshot(captureSaveSnapshot(dirPath))
  }

  const saveLater = async (dirPath: string) => {
    await scheduleSaveSnapshot(captureSaveSnapshot(dirPath))
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
      saveLater,
    isCreatingRef,
    currentLoadedRoomPathRef,
    storeApi,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    getActiveGraphSession,
    saveNow,
      saveLater,
    storeApi,
    // 关系定义来自全局 _config.json 的 hydrate 结果；注入 getter 而不是让
    // 纯操作层直接依赖 store，回归脚本可以直接注入自定义定义真跑。
    getEdgeRelations: () => useGraphUiStore.getState().edgeRelations,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    tabId,
    getActiveGraphSession,
    saveNow,
      saveLater,
    storeApi,
  })

  // ===== Selection =====

  const selectionOps = buildSelectionOperations({
    tabId,
    storeApi,
  })

  // ===== 多选区域水平镜像（写闸门在 useGraph 统一包住） =====

  const selectionMirrorOps = buildSelectionMirrorOperations({
    getActiveGraphSession,
    saveLater,
    storeApi,
  })

  // ===== 选中子树（纯视图态：不过写闸门、不落盘） =====

  const selectionSubtreeOps = buildSelectionSubtreeOperations({ storeApi })

  // ===== 左侧节点树拖动排序（写闸门在 useGraph 统一包住） =====

  const nodeTreeOps = buildNodeTreeOperations({
    getActiveGraphSession,
    saveLater,
    storeApi,
  })

  return {
    // Node CRUD
    ...nodeCrudOps,
    // Edge CRUD
    ...edgeOps,
    // Position changes
    ...nodeChangeOps,
    // Selection
    ...selectionOps,
    // Multi-selection horizontal mirror
    ...selectionMirrorOps,
    // Select whole subtree(s) rooted at the selected nodes
    ...selectionSubtreeOps,
    // 左侧节点树排序（只写 data.treeOrder）
    ...nodeTreeOps,
    updateNodeEmojis: nodeCrudOps.updateNodeEmojis,
    // Internal
    captureSaveSnapshot,
    saveSnapshot,
    scheduleSaveSnapshot,
    saveNow,
    saveLater,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>
