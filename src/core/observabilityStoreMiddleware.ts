/**
 * P7 M3：zustand 状态 diff → 内存步骤（默认不落盘）。
 *
 * 对提案 §5 M3 的工程修正（见方案 §9）：原设想让 diff 自动落盘 1 条
 * `internal` 类 `state.change`。但 P7.3 之后，每个状态变更已有唯一的落盘
 * 结果事实（kb.import / node.delete / document.save ...），再写 state.change
 * 会变成「一次变更两条日志」，与事实唯一性不变量冲突，也会让多个 store 的
 * 高频更新重新变成噪声。因此这里把 diff 定位为 M4 的自动补充：
 * 只写 traceBuffer 的内存步骤，error / 诊断包导出时随该 trace dump 落盘。
 *
 * 约束：
 *  - 只观测持久化字段；selected / dragging / hover 等运行时视图态不进 diff；
 *  - 值只记「类型 + 长度 + 短哈希」或安全短枚举，不落路径 / 标题 / 正文明文；
 *  - 不写日志、不调用 IPC、不建定时器（避免自放大与 P0 的永动定时器问题）；
 *  - 无交互上下文时 recordStep 自动丢弃，不伪造因果。
 */
import type { StoreApi } from 'zustand'
import { stableHash32 } from '../shared/observability/logContract.ts'
import { recordStep } from './traceBuffer.ts'

/** 运行时视图态：变化频繁、不持久化、无取证价值；函数名也会被自动跳过。 */
export const RUNTIME_STATE_KEYS: readonly string[] = [
  'selected', 'selectedNodeIds', 'selectedNodes', 'selectedNodeCount', 'selectedEdgeId',
  'dragging', 'dragState', 'hover', 'hovered', 'focus', 'focused', 'loading', 'isLoading',
  'pending', 'isPending', 'interactionActive', 'isDragging', 'viewport', 'size', 'width', 'height',
  'scroll', 'scrollTop', 'error', 'warning', 'toast', 'modal', 'dialog', 'isOpen', 'expanded',
]

/** 字段名含这些片段时，值一律遮蔽，只留长度。 */
const SENSITIVE_HINTS: readonly string[] = [
  'path', 'title', 'label', 'name', 'content', 'text', 'body', 'markdown', 'html',
  'token', 'secret', 'password', 'credential', 'email', 'url', 'uri', 'file', 'dir',
]

export interface StateChangeField {
  key: string
  from: string
  to: string
}

export interface StateChangeSummary {
  store: string
  fields: StateChangeField[]
  changed: number
}

export interface StateObservationOptions {
  /** store 名，写进步骤名，便于 dump 时定位。 */
  name: string
  /** 追加排除的字段（在 RUNTIME_STATE_KEYS 之外）。 */
  omit?: readonly string[]
  /** 单次 diff 最多观测多少个变化字段，默认 12。 */
  maxFields?: number
}

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_HINTS.some((hint) => lower.includes(hint))
}

/**
 * 把任意值压成不可逆摘要。短且安全的枚举值保留明文，其余只留类型/长度/哈希，
 * 这样既能检测「变没变」，又不会把用户文档标题或路径带进日志。
 */
export function summarizeValue(value: unknown, sensitive = false): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'function') return 'fn'
  if (typeof value === 'boolean' || typeof value === 'number') return `${typeof value}:${String(value)}`
  if (typeof value === 'string') {
    if (!sensitive && value.length <= 24 && !/[\\/]/.test(value)) return `str:${value}`
    return `${sensitive ? '[redacted]' : 'str'}:${value.length}:${stableHash32(value)}`
  }
  if (Array.isArray(value)) return `array:${value.length}`
  if (typeof value === 'object') {
    let serialized = ''
    try {
      serialized = JSON.stringify(value)
    } catch {
      serialized = '[circular]'
    }
    return `object:${Object.keys(value as object).length}:${stableHash32(serialized.slice(0, 4096))}`
  }
  return `${typeof value}`
}

/** 纯函数：比较两个快照，返回压缩后的变化摘要；无变化返回 null。 */
export function diffStateChange<T extends object>(
  prev: T,
  next: T,
  options: StateObservationOptions,
): StateChangeSummary | null {
  if (!prev || !next) return null
  const omitted = new Set<string>([...RUNTIME_STATE_KEYS, ...(options.omit ?? [])])
  const maxFields = Math.max(1, options.maxFields ?? 12)
  const fields: StateChangeField[] = []
  let changed = 0

  for (const key of Object.keys(next as object)) {
    if (omitted.has(key)) continue
    const before = (prev as Record<string, unknown>)[key]
    const after = (next as Record<string, unknown>)[key]
    if (typeof before === 'function' || typeof after === 'function') continue
    const sensitive = isSensitive(key)
    const from = summarizeValue(before, sensitive)
    const to = summarizeValue(after, sensitive)
    if (from === to) continue
    changed += 1
    if (fields.length < maxFields) fields.push({ key, from, to })
  }

  if (changed === 0) return null
  return { store: options.name, fields, changed }
}

/**
 * 给一个 zustand store 挂上状态观测。返回取消订阅函数。
 * 只写内存步骤；没有交互上下文时步骤会被 traceBuffer 自动丢弃。
 */
export function attachStateObservation<T extends object>(
  store: StoreApi<T>,
  options: StateObservationOptions,
): () => void {
  return store.subscribe((state, prevState) => {
    const summary = diffStateChange(prevState, state, options)
    if (!summary) return
    recordStep({
      name: `state.change.${options.name}`,
      outcome: 'changed',
      params: {
        store: summary.store,
        changed: summary.changed,
        fields: summary.fields.map((f) => ({ key: f.key, from: f.from, to: f.to })),
      },
    })
  })
}
