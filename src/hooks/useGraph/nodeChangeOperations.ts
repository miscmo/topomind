import {
  captureGraphHistorySnapshot,
  commitGraphHistorySnapshot,
  graphNodeIndexCache,
  type GraphHistorySnapshot,
  type GraphState,
  type GraphStoreApi,
} from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { computeIncrementalNodes } from '../../domain/graph/incrementalNodes'
import { CANVAS_OPERATIONS } from '@/shared/observability/performanceContract'
import {
  PERFORMANCE_METRICS,
  newPerformanceTraceId,
  recordPerformance,
  startPerformanceSpan,
} from '../../core/performance-log'
import { readCanvasScale, startCanvasSpan } from './canvasPerformanceContext'
import { resolveGestureSampleTiming } from '@/shared/observability/gestureTiming'

export interface NodeChangeOperationsDeps {
  tabId: string
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  saveLater: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
}

// 节点增量更新的唯一实现在 domain/graph/incrementalNodes.ts：只给真正变化的节点
// 换引用，其余保持原引用；id→index 索引按数组引用缓存，连续帧不再每帧重建全图
// Map。换房间 / undo 产生的外部新数组没有缓存记录，自动重建，不会静默跳过变更。

export function buildNodeChangeOperations(deps: NodeChangeOperationsDeps) {
  const {
    getActiveGraphSession,
    saveLater,
    storeApi,
  } = deps

  const graphStoreApi = storeApi as GraphStoreApi
  let dragHistoryBaseline: GraphHistorySnapshot | null = null
  let resizeHistoryBaseline: GraphHistorySnapshot | null = null

  // 手势按「一次会话」上报一条样本：逐帧只累加计数，帧内不写日志、不 await。
  // movedCount 同时区分单个移动与多选批量移动，无需拆成两个指标。
  type GestureKind = 'drag' | 'resize'
  interface GestureSession {
    operation: GestureKind
    traceId: string
    roomPath: string
    startedAt: number
    lastFrameAt: number
    frameCount: number
    maxFrameMs: number
    movedCount: number
  }
  const gestureSessions: Partial<Record<GestureKind, GestureSession>> = {}

  const beginGesture = (kind: GestureKind, roomPath: string) => {
    if (gestureSessions[kind]) return
    const now = performance.now()
    gestureSessions[kind] = {
      operation: kind,
      traceId: newPerformanceTraceId('gesture'),
      roomPath,
      startedAt: now,
      lastFrameAt: now,
      frameCount: 0,
      maxFrameMs: 0,
      movedCount: 1,
    }
  }

  const trackGesture = (kind: GestureKind, affectedCount: number) => {
    const session = gestureSessions[kind]
    if (!session) return
    const now = performance.now()
    session.frameCount += 1
    session.maxFrameMs = Math.max(session.maxFrameMs, now - session.lastFrameAt)
    session.lastFrameAt = now
    session.movedCount = Math.max(session.movedCount, affectedCount)
  }

  const endGesture = (kind: GestureKind) => {
    const session = gestureSessions[kind]
    if (!session) return
    delete gestureSessions[kind]
    const operation = kind === 'drag' ? CANVAS_OPERATIONS.drag : CANVAS_OPERATIONS.resize
    // durationMs 只取最慢一帧；总时长（含按住不动）另存 elapsedMs，见 gestureTiming.ts。
    const timing = resolveGestureSampleTiming({
      frameCount: session.frameCount,
      maxFrameMs: session.maxFrameMs,
      elapsedMs: performance.now() - session.startedAt,
      dropSingleFrame: kind === 'resize',
    })
    if (!timing) return
    recordPerformance(PERFORMANCE_METRICS.canvasGesture, timing.durationMs, {
      module: 'graphOperations',
      traceId: session.traceId,
      contextKey: session.roomPath,
      params: {
        frameCount: session.frameCount,
        maxFrameMs: timing.maxFrameMs,
        elapsedMs: timing.elapsedMs,
        ...readCanvasScale(storeApi, {
          operation,
          roomPath: session.roomPath,
          affectedCount: session.movedCount,
        }),
      },
    })
  }

  const beginInteractionHistory = (kind: 'drag' | 'resize') => {
    const baseline = kind === 'drag' ? dragHistoryBaseline : resizeHistoryBaseline
    if (baseline) return
    const nextBaseline = captureGraphHistorySnapshot(storeApi.getState())
    if (kind === 'drag') dragHistoryBaseline = nextBaseline
    else resizeHistoryBaseline = nextBaseline
    graphStoreApi.temporal.getState().pause()
  }

  const finishInteractionHistory = (kind: 'drag' | 'resize') => {
    const baseline = kind === 'drag' ? dragHistoryBaseline : resizeHistoryBaseline
    if (!baseline) return
    if (kind === 'drag') dragHistoryBaseline = null
    else resizeHistoryBaseline = null
    const otherInteractionActive = kind === 'drag' ? resizeHistoryBaseline !== null : dragHistoryBaseline !== null
    if (!otherInteractionActive) graphStoreApi.temporal.getState().resume()
    commitGraphHistorySnapshot(graphStoreApi, baseline)
  }

  const applyNodePositionChanges = async (changes: Array<{ id: string; position?: { x: number; y: number }; dragging?: boolean }>) => {
    const store = storeApi.getState()
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
      const cp = change.position
      if (!cp) return { changed: false, node }
      if (node.position.x === cp.x && node.position.y === cp.y) return { changed: false, node }
      return { changed: true, node: { ...node, position: cp } }
    }, graphNodeIndexCache)

    const isDragging = changes.some((change) => change.dragging === true)
    const isDragEnd = changes.some((change) => change.dragging === false)

    if (isDragging || isDragEnd) {
      beginGesture('drag', currentRoomPath)
      trackGesture('drag', result?.changedIds.length ?? changes.length)
    }

    if (isDragging) beginInteractionHistory('drag')
    if (isDragEnd) {
      finishInteractionHistory('drag')
      // 在 await saveLater 之前收口：debounce 的 300ms 不属于用户手势时长。
      endGesture('drag')
    }

    const shouldSaveNow = changes.some((change) => change.dragging === false)
    if (currentRoomPath && shouldSaveNow) {
      await saveLater(currentRoomPath)
    }

    if (result) {
      store.setNodesPreservingSelection(result.nextNodes, result.changedIds)
    }
  }

  const applyNodeRemoveChanges = async (changeIds: string[]) => {
    const store = storeApi.getState()
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const span = startPerformanceSpan(PERFORMANCE_METRICS.canvasEdit, {
      module: 'graphOperations',
      traceId: newPerformanceTraceId('graph'),
      contextKey: currentRoomPath,
      params: {
        // React Flow remove change 只改内存并触发全量落盘，不进回收站；如实记录便于追溯。
        trashed: false,
        ...readCanvasScale(storeApi, {
          operation: CANVAS_OPERATIONS.deleteBatch,
          roomPath: currentRoomPath,
          affectedCount: changeIds.length,
        }),
      },
    })
    try {
      store.removeNodes(changeIds)
      store.removeEdgesByNodeIds(changeIds)
      if (currentRoomPath) await saveLater(currentRoomPath)
      span.end()
    } catch (error) {
      span.fail(error)
      throw error
    }
  }

  const applyNodeDimensionChanges = async (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean; origin?: 'auto-size' | 'manual' }>) => {
    let shouldSave = false
    const store = storeApi.getState()
    const resizeRoomPath = (() => {
      const session = getActiveGraphSession()
      return session.roomPath || session.kbPath || ''
    })()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
      const dims = change.dimensions
      const nextWidth = dims?.width ?? node.width ?? node.initialWidth ?? node.measured?.width ?? 120
      const nextHeight = dims?.height ?? node.height ?? node.initialHeight ?? node.measured?.height ?? 52
      const nextMeasured = dims === undefined ? node.measured : (dims || undefined)
      if (node.width === nextWidth && node.height === nextHeight && node.measured === nextMeasured) {
        return { changed: false, node }
      }
      if (dims && !change.resizing) {
        shouldSave = true
      }

      const isExpanded = nextWidth >= 160 && nextHeight >= 96
      const wasExpanded = (node.width ?? 0) >= 160 && (node.height ?? 0) >= 96

      const expandedDimensions: Record<string, number> = {}
      if (isExpanded) {
        expandedDimensions.expandedWidth = nextWidth
        expandedDimensions.expandedHeight = nextHeight
      } else {
        expandedDimensions.collapsedWidth = nextWidth
        expandedDimensions.collapsedHeight = nextHeight
      }

      // If transitioning from expanded to collapsed, save the previous expanded dimensions
      if (!isExpanded && wasExpanded && node.width !== undefined && node.height !== undefined) {
        expandedDimensions.expandedWidth = node.width
        expandedDimensions.expandedHeight = node.height
      }

      // If transitioning from collapsed to expanded, save the previous collapsed dimensions
      if (isExpanded && !wasExpanded && node.width !== undefined && node.height !== undefined) {
        expandedDimensions.collapsedWidth = node.width
        expandedDimensions.collapsedHeight = node.height
      }

      const isAutoSizeChange = change.origin === 'auto-size'
      const prevWidth = node.width ?? node.initialWidth ?? node.measured?.width ?? 120
      const prevHeight = node.height ?? node.initialHeight ?? node.measured?.height ?? 52
      const widthChanged = Math.abs(prevWidth - nextWidth) > 0.5
      const heightChanged = Math.abs(prevHeight - nextHeight) > 0.5
      const shouldSwitchToManual = !isAutoSizeChange && (widthChanged || heightChanged)
      return {
        changed: true,
        node: {
          ...node,
          width: nextWidth,
          height: nextHeight,
          measured: nextMeasured,
          data: {
            ...node.data,
            ...expandedDimensions,
            ...(shouldSwitchToManual ? { widthMode: 'manual' as const, heightMode: 'manual' as const } : {}),
          },
        },
      }
    }, graphNodeIndexCache)

    const isResizing = changes.some((change) => change.resizing === true)
    const isResizeEnd = changes.some((change) => change.resizing === false)
    if (isResizing || isResizeEnd) {
      beginGesture('resize', resizeRoomPath)
      trackGesture('resize', result?.changedIds.length ?? changes.length)
    }
    if (isResizing) beginInteractionHistory('resize')

    if (result) store.setNodesPreservingSelection(result.nextNodes, result.changedIds)
    if (isResizeEnd) {
      finishInteractionHistory('resize')
      endGesture('resize')
    }

    if (shouldSave && resizeRoomPath) await saveLater(resizeRoomPath)
  }

  const applyNodeSelectionChanges = (changes: Array<{ id: string; selected: boolean }>) => {
    const store = storeApi.getState()
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    // React Flow 的 Shift 拖框每帧都会派发一次 select change（见 commitUserSelectionRect）。
    // 一帧一条样本，配合 operation=box_select 才能量出「多选过程中」的真实帧耗时；
    // 之前多选链路零埋点，看板上完全看不到这次卡顿。
    const operation = changes.length > 1
      ? CANVAS_OPERATIONS.boxSelect
      : CANVAS_OPERATIONS.select
    const span = startCanvasSpan(storeApi, {
      operation,
      roomPath: currentRoomPath,
      module: 'graphOperations',
      params: {
        changedCount: changes.length,
        selectedBefore: typeof store.selectedNodeCount === 'number' ? store.selectedNodeCount : 0,
        selectionMode: changes.length > 1 ? 'box' : 'single',
      },
    })
    try {
      const changesById = new Map(changes.map((change) => [change.id, change]))
      const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
        if (node.selected === change.selected) return { changed: false, node }
        return { changed: true, node: { ...node, selected: change.selected } }
      }, graphNodeIndexCache)

      if (result) {
        // 选中态专用通道：只刷新被改的 K 个 nodesMap 条目，并跳过 zundo 的
        // O(N) 快照比较（selected 是运行时字段，本来就不该进历史）。
        store.applySelectionChanges(result.nextNodes, result.changedNodes)
      }
      span.end({
        appliedCount: result?.changedIds.length ?? 0,
        skipped: !result,
      })
    } catch (error) {
      span.fail(error)
      throw error
    }
  }

  return {
    applyNodePositionChanges,
    applyNodeRemoveChanges,
    applyNodeDimensionChanges,
    applyNodeSelectionChanges,
  }
}
