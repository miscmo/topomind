/**
 * 画布性能样本的统一规模上下文。
 *
 * 铁律：只做 O(1) 读取。新建 / 删除节点的热路径被回归脚本按源码切片校验，
 * 为了埋点去 nodes.map(...) 或 await 任何东西都会破坏性能契约。
 */
import type { StoreApi } from 'zustand'

import {
  PERFORMANCE_METRICS,
  type CanvasOperationId,
  type PerformanceMetricId,
} from '@/shared/observability/performanceContract'
import { newPerformanceTraceId, startPerformanceSpan, type PerformanceSpan } from '../../core/performance-log'
import type { GraphState } from '../../stores/graphStore'
import { getActiveCanvasReadOnly } from '../../stores/canvasReadOnlyStore'

export interface CanvasScaleContext {
  nodeCount: number
  edgeCount: number
  selectedCount: number
  affectedCount: number
  hiddenCount: number
  zoom: number
  readOnly: boolean
  roomPath: string
  operation: CanvasOperationId
  /** 给人看的摘要，慢样本面板直接显示；不要塞进关键词检索以外的结构化字段。 */
  scaleLabel: string
}

export interface CanvasScaleInput {
  operation: CanvasOperationId
  roomPath?: string
  affectedCount?: number
}

/** 纯格式化：写盘侧没有 store 句柄时也能生成同样的摘要。 */
export function formatCanvasScaleLabel(input: {
  nodeCount: number
  edgeCount?: number
  hiddenCount?: number
  affectedCount?: number
  roomPath?: string
}): string {
  const parts = [`${input.nodeCount} 节点`]
  if (typeof input.edgeCount === 'number') parts.push(`${input.edgeCount} 边`)
  if (typeof input.hiddenCount === 'number' && input.hiddenCount > 0) {
    parts.push(`隐藏 ${input.hiddenCount}`)
  }
  if (typeof input.affectedCount === 'number' && input.affectedCount > 1) {
    parts.push(`影响 ${input.affectedCount}`)
  }
  if (input.roomPath) parts.push(input.roomPath)
  return parts.join(' · ')
}

export function readCanvasScale(
  storeApi: Pick<StoreApi<GraphState>, 'getState'>,
  input: CanvasScaleInput,
): CanvasScaleContext {
  // 回归脚本会用精简 mock store 真跑 CRUD 链路；这里必须容忍缺字段，不能让埋点成为崩溃源。
  const state = storeApi.getState() as Partial<GraphState> | undefined
  const nodeCount = Array.isArray(state?.nodes) ? state.nodes.length : 0
  const edgeCount = Array.isArray(state?.edges) ? state.edges.length : 0
  const selectedCount = typeof state?.selectedNodeCount === 'number' ? state.selectedNodeCount : 0
  const zoom = typeof state?.viewport?.zoom === 'number' ? state.viewport.zoom : 0
  const readOnly = getActiveCanvasReadOnly()
  const hiddenCount = readOnly?.hiddenNodeCount ?? 0
  const affectedCount = input.affectedCount ?? 1
  const roomPath = input.roomPath ?? ''
  return {
    nodeCount,
    edgeCount,
    selectedCount,
    affectedCount,
    hiddenCount,
    zoom: Number(zoom.toFixed(3)),
    readOnly: readOnly?.readOnly ?? false,
    roomPath,
    operation: input.operation,
    scaleLabel: formatCanvasScaleLabel({ nodeCount, edgeCount, hiddenCount, affectedCount, roomPath }),
  }
}

export interface CanvasSpanInput extends CanvasScaleInput {
  /** 默认 canvas_edit；查询/定位传 canvas_query，可见集合重算传 canvas_lod。 */
  metric?: PerformanceMetricId
  traceId?: string
  contextKey?: string
  module?: string
  /** 额外上下文；规模字段由 readCanvasScale 单一生成，放在最后避免被覆盖。 */
  params?: Record<string, unknown>
}

/**
 * 画布埋点的唯一入口：一次调用同时拿到 O(1) 规模上下文、链路 id 与 span。
 * 业务侧只需 `const span = startCanvasSpan(...); ...; span.end(...)`。
 */
export function startCanvasSpan(
  storeApi: Pick<StoreApi<GraphState>, 'getState'>,
  input: CanvasSpanInput,
): PerformanceSpan {
  const scale = readCanvasScale(storeApi, input)
  const traceId = input.traceId ?? newPerformanceTraceId('canvas')
  return startPerformanceSpan(input.metric ?? PERFORMANCE_METRICS.canvasEdit, {
    module: input.module ?? 'canvas',
    traceId,
    contextKey: input.contextKey ?? `${scale.roomPath}:${input.operation}`,
    params: { ...input.params, ...scale },
  })
}
