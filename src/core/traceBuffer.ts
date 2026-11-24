/**
 * P7 M4：内部过程步骤的内存缓冲（D2 黑匣子哲学的一般化）。
 *
 * 「selectNode 被调用」「对话框打开」「store 写回」这类过程痕迹平时没人看，
 * 出事时又需要。v2/v3 早期把它们全量落盘，造成一次点击 4 条 user 日志；
 * 现在默认只按 traceId 存在内存，仅在 error / 慢操作 / 诊断包导出时
 * 由日志链路 dump 到落盘条目的 steps 字段（P7.5）。
 *
 * 约束：
 *  - 不写日志、不调用 IPC、不建定时器（P0 的永动定时器教训）；
 *  - 无 traceId 的独立事件（周期聚合等）不记步骤，避免伪造因果；
 *  - 上限与丢弃数如实暴露，不静默截断。
 */
import {
  getCurrentTraceId,
  type TraceStep,
} from '../shared/observability/logContract.ts'

/** 同时保留的交互条数；超出按最久未更新淘汰。 */
export const MAX_TRACES = 200
/** 单条交互保留的步骤数。 */
export const MAX_STEPS_PER_TRACE = 100
/** dump 时默认导出的最近步骤数（与 P3 breadcrumbs 的 50 条口径一致）。 */
export const STEP_DUMP_LIMIT = 50

export interface StepInput {
  name: string
  at?: number
  durationMs?: number
  outcome?: string
  spanId?: string
  parentId?: string
  params?: Record<string, unknown> | null
}

interface TraceRecord {
  traceId: string
  steps: TraceStep[]
  dropped: number
  startedAt: number
  updatedAt: number
}

const _traces = new Map<string, TraceRecord>()
let _droppedTraces = 0

function resolveTraceId(explicit?: string | null): string | null {
  if (explicit === null) return null
  return explicit ?? getCurrentTraceId()
}

/** 记一个过程步骤；返回 null 表示当前无交互上下文，未记录。 */
export function recordStep(step: StepInput, traceId?: string | null): TraceStep | null {
  const id = resolveTraceId(traceId)
  if (!id) return null
  const now = typeof step.at === 'number' && Number.isFinite(step.at) ? step.at : Date.now()
  let record = _traces.get(id)
  if (!record) {
    if (_traces.size >= MAX_TRACES) {
      let oldestId: string | null = null
      let oldestAt = Infinity
      for (const [key, value] of _traces) {
        if (value.updatedAt < oldestAt) {
          oldestAt = value.updatedAt
          oldestId = key
        }
      }
      if (oldestId) _traces.delete(oldestId)
      _droppedTraces += 1
    }
    record = { traceId: id, steps: [], dropped: 0, startedAt: now, updatedAt: now }
    _traces.set(id, record)
  }
  const entry: TraceStep = {
    name: step.name.slice(0, 80),
    at: now,
    ...(typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)
      ? { durationMs: Math.max(0, Math.round(step.durationMs)) } : {}),
    ...(typeof step.outcome === 'string' ? { outcome: step.outcome.slice(0, 40) } : {}),
    ...(typeof step.spanId === 'string' ? { spanId: step.spanId } : {}),
    ...(typeof step.parentId === 'string' ? { parentId: step.parentId } : {}),
    ...(step.params ? { params: step.params } : {}),
  }
  if (record.steps.length >= MAX_STEPS_PER_TRACE) {
    record.steps.shift()
    record.dropped += 1
  }
  record.steps.push(entry)
  record.updatedAt = now
  return entry
}

/** 写入时刻该交互已有的步骤数（如实值，不预估后续步骤）。 */
export function stepCount(traceId?: string | null): number {
  const id = resolveTraceId(traceId)
  if (!id) return 0
  return _traces.get(id)?.steps.length ?? 0
}

/** 按需导出最近 N 个步骤，供 error / 诊断包落盘。 */
export function dumpSteps(traceId?: string | null, limit = STEP_DUMP_LIMIT): TraceStep[] {
  const id = resolveTraceId(traceId)
  if (!id) return []
  const steps = _traces.get(id)?.steps ?? []
  return steps.slice(Math.max(0, steps.length - limit))
}

export function clearTrace(traceId?: string | null): void {
  const id = resolveTraceId(traceId)
  if (id) _traces.delete(id)
}

export function traceBufferStats(): {
  traces: number
  steps: number
  droppedSteps: number
  droppedTraces: number
} {
  let steps = 0
  let droppedSteps = 0
  for (const record of _traces.values()) {
    steps += record.steps.length
    droppedSteps += record.dropped
  }
  return { traces: _traces.size, steps, droppedSteps, droppedTraces: _droppedTraces }
}

/** 仅测试用：清空全部状态。 */
export function resetTraceBuffer(): void {
  _traces.clear()
  _droppedTraces = 0
}
