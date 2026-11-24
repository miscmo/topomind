/**
 * v3 P4 视图模型 —— 纯函数层（唯一真源，UI 与门禁共用）
 *
 * 存在的理由：五视图的「分组 / 折叠 / span 树 / 指纹聚合 / 回放」都是可测的
 * 数据变换，不该埋在 React 组件里。放在 shared/observability 让 monitor 插件
 * 与 scripts/verify-logging.mts 用同一份实现，避免「UI 看着对、行为没断言」。
 *
 * 约束：
 * - 不依赖 React / DOM / electron，Node 门禁可直接 import；
 * - 只读 LogEntry，不修改入参（所有排序都先复制）；
 * - 读时兼容交给 categoryFromLegacy 与 normalizeLogEntry，这里不补字段。
 */
import {
  LOG_CATEGORIES,
  categoryFromLegacy,
  type Breadcrumb,
  type LogEntry,
} from './logContract.ts'

export interface ViewFilters {
  keyword?: string | null
  levels?: string[]
  categories?: string[]
  /** 会话选择（D5 补偿：不按物理目录组织叙事）。 */
  sessionId?: string | null
  /** 跨视图联动：只保留某一次操作链。 */
  traceId?: string | null
  /** 纯 UI 降采样；1 表示不采样。采集侧采样另由事件目录 sampleRate 决定。 */
  displaySampleRate?: number
}

export interface TraceGroup {
  traceId: string
  sessionId: string
  /** 叙事标题：优先 user 事件，否则取组内最早一条。 */
  root: LogEntry | null
  entries: LogEntry[]
  categoryCounts: Record<string, number>
  levelCounts: Record<string, number>
  startedAt: number
  endedAt: number
  durationMs: number
  hasError: boolean
  /** P5：≥2 条才算一条操作链；单条 / 无 trace 的是独立事件，不伪装成操作卡。 */
  isChain: boolean
  /** 无 traceId（orphan:*）= 周期任务、主进程日志等，本就不属于任何操作。 */
  independent: boolean
  /** 链路结果：优先异常，其次根事件/末条事件的 result。 */
  outcome: string | null
}

export interface SessionGroup {
  sessionId: string
  traces: TraceGroup[]
  entryCount: number
  startedAt: number
  endedAt: number
}

export interface SpanNode {
  entry: LogEntry
  depth: number
  children: SpanNode[]
  durationMs: number
}

export interface ErrorGroup {
  fingerprint: string
  count: number
  firstSeen: string
  lastSeen: string
  sample: LogEntry
  entries: LogEntry[]
  sessions: string[]
  breadcrumbCount: number
  hasDumpRef: boolean
}

const UNKNOWN_SESSION = 'legacy@unknown'
const UNKNOWN_TRACE = 'orphan'

export function timeOf(entry: LogEntry): number {
  const parsed = Date.parse(entry.timestamp ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function seqOf(entry: LogEntry): number {
  return Number.isFinite(entry.seq) ? Number(entry.seq) : -1e9
}

/** 与主进程 _sortEntries 同口径：timestamp → seq → id，稳定且跨类可回放。 */
export function sortByTime(entries: readonly LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => {
    const ta = timeOf(a)
    const tb = timeOf(b)
    if (ta !== tb) return ta - tb
    const sa = seqOf(a)
    const sb = seqOf(b)
    if (sa !== sb) return sa - sb
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

function errorText(entry: LogEntry): string {
  if (typeof entry.error === 'string') return entry.error
  return entry.error?.message ?? ''
}

/** 与主进程 _matches 的 haystack 口径一致，另补 label / params 的可读字段。 */
function haystack(entry: LogEntry): string {
  return [
    entry.message,
    entry.label,
    entry.action,
    entry.module,
    errorText(entry),
    entry.params ? JSON.stringify(entry.params) : '',
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * 显示采样只作用于 internal / performance：user 与 error 永远全量保留，
 * 否则降采样会抹掉「谁触发的」和「哪里断了」，恰好毁掉透明化目标。
 */
export function applyDisplaySample(entries: readonly LogEntry[], rate = 1): LogEntry[] {
  if (!(rate > 0) || rate >= 1) return [...entries]
  const stride = rate <= 0.1 ? 10 : 2
  return entries.filter((entry, index) => {
    if (entry.level === 'ERROR' || entry.category === 'user' || entry.category === 'error') return true
    return index % stride === 0
  })
}

export function filterViewEntries(entries: readonly LogEntry[], filters: ViewFilters = {}): LogEntry[] {
  const keyword = filters.keyword ? String(filters.keyword).toLowerCase() : ''
  const levels = filters.levels?.length ? new Set(filters.levels) : null
  const categories = filters.categories?.length ? new Set(filters.categories) : null
  const matched = entries.filter((entry) => {
    if (keyword && !haystack(entry).includes(keyword)) return false
    if (levels && !levels.has(entry.level ?? 'INFO')) return false
    if (categories && !categories.has(entry.category ?? categoryFromLegacy(entry))) return false
    if (filters.sessionId && (entry.sessionId ?? UNKNOWN_SESSION) !== filters.sessionId) return false
    if (filters.traceId && (entry.traceId ?? '') !== filters.traceId) return false
    return true
  })
  return sortByTime(applyDisplaySample(matched, filters.displaySampleRate ?? 1))
}

/** 无 traceId 的条目单独成组，不强行并到别的链路上（避免伪造因果）。 */
export function groupByTrace(entries: readonly LogEntry[]): TraceGroup[] {
  const buckets = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    const key = entry.traceId || `${UNKNOWN_TRACE}:${entry.id ?? buckets.size}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }
  return [...buckets.entries()].map(([traceId, raw]) => {
    const ordered = sortByTime(raw)
    const categoryCounts: Record<string, number> = {}
    const levelCounts: Record<string, number> = {}
    let hasError = false
    for (const entry of ordered) {
      const category = entry.category ?? categoryFromLegacy(entry)
      const level = entry.level ?? 'INFO'
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1
      levelCounts[level] = (levelCounts[level] ?? 0) + 1
      if (level === 'ERROR' || category === 'error') hasError = true
    }
    const root = ordered.find((entry) => (entry.category ?? categoryFromLegacy(entry)) === 'user') ?? ordered[0] ?? null
    const startedAt = timeOf(ordered[0] ?? {})
    const endedAt = timeOf(ordered[ordered.length - 1] ?? {})
    const independent = traceId.startsWith(`${UNKNOWN_TRACE}:`)
    const last = ordered[ordered.length - 1]
    return {
      traceId,
      sessionId: ordered[0]?.sessionId ?? UNKNOWN_SESSION,
      root,
      entries: ordered,
      categoryCounts,
      levelCounts,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      hasError,
      isChain: ordered.length > 1,
      independent,
      outcome: hasError ? 'failure' : (root?.result ?? last?.result ?? null),
    }
  }).sort((a, b) => a.startedAt - b.startedAt)
}

export function listSessionIds(entries: readonly LogEntry[]): string[] {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const id = entry.sessionId ?? UNKNOWN_SESSION
    seen.set(id, Math.max(seen.get(id) ?? 0, timeOf(entry)))
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

export function groupBySession(entries: readonly LogEntry[]): SessionGroup[] {
  const buckets = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    const key = entry.sessionId ?? UNKNOWN_SESSION
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }
  return [...buckets.entries()].map(([sessionId, raw]) => {
    const ordered = sortByTime(raw)
    return {
      sessionId,
      traces: groupByTrace(ordered),
      entryCount: ordered.length,
      startedAt: timeOf(ordered[0] ?? {}),
      endedAt: timeOf(ordered[ordered.length - 1] ?? {}),
    }
  }).sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * span 树：parentId 指向上层 spanId，找不到父或自环的挂到根。
 * durationMs 优先用条目自带值，否则用首尾时间差（供瀑布条使用）。
 */
export function buildSpanTree(entries: readonly LogEntry[]): SpanNode[] {
  const ordered = sortByTime(entries)
  const nodes = new Map<string, SpanNode>()
  for (const entry of ordered) {
    const key = entry.spanId ?? `leaf:${entry.id ?? nodes.size}`
    nodes.set(key, {
      entry,
      depth: 0,
      children: [],
      durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : 0,
    })
  }
  const roots: SpanNode[] = []
  for (const entry of ordered) {
    const key = entry.spanId ?? `leaf:${entry.id ?? ''}`
    const node = nodes.get(key)
    if (!node) continue
    const parent = entry.parentId && entry.parentId !== key ? nodes.get(entry.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const assignDepth = (node: SpanNode, depth: number) => {
    node.depth = depth
    for (const child of node.children) assignDepth(child, depth + 1)
  }
  for (const root of roots) assignDepth(root, 0)
  return roots
}

export function flattenSpanTree(roots: readonly SpanNode[]): SpanNode[] {
  const out: SpanNode[] = []
  const walk = (node: SpanNode) => {
    out.push(node)
    for (const child of node.children) walk(child)
  }
  for (const root of roots) walk(root)
  return out
}

/** 回放就是按时间逐条前进；返回有序步骤，UI 用 replayCursor 索引。 */
export function replaySteps(entries: readonly LogEntry[], filters: ViewFilters = {}): LogEntry[] {
  return filterViewEntries(entries, { ...filters, displaySampleRate: 1 })
}

export function isErrorEntry(entry: LogEntry): boolean {
  return entry.level === 'ERROR' || (entry.category ?? categoryFromLegacy(entry)) === 'error'
}

/** 指纹聚合：同一 fingerprint 归一组，未带指纹的按 name+message 归一后兜底。 */
export function groupErrorsByFingerprint(entries: readonly LogEntry[]): ErrorGroup[] {
  const buckets = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    if (!isErrorEntry(entry)) continue
    const fallback = `${errorText(entry) || entry.action || 'error'}`.slice(0, 120)
    const key = entry.fingerprint || `nofp:${fallback}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }
  return [...buckets.entries()].map(([fingerprint, raw]) => {
    const ordered = sortByTime(raw)
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    return {
      fingerprint,
      count: ordered.length,
      firstSeen: first?.timestamp ?? '',
      lastSeen: last?.timestamp ?? '',
      sample: last ?? first!,
      entries: ordered,
      sessions: [...new Set(ordered.map((e) => e.sessionId ?? UNKNOWN_SESSION))],
      breadcrumbCount: ordered.reduce((sum, e) => sum + (e.breadcrumbs?.length ?? 0), 0),
      hasDumpRef: ordered.some((e) => Boolean(e.dumpRef?.available)),
    }
  }).sort((a, b) => b.count - a.count || timeOf(b.sample) - timeOf(a.sample))
}

export function findRecoveryReports(entries: readonly LogEntry[]): LogEntry[] {
  return sortByTime(entries.filter((entry) => entry.action === 'app.crash_recovered'))
}

export function flattenBreadcrumbs(entry: LogEntry | null): Breadcrumb[] {
  if (!entry?.breadcrumbs?.length) return []
  return [...entry.breadcrumbs].sort((a, b) => a.seq - b.seq || a.t - b.t)
}

export function categoryLabel(category: string | undefined): string {
  if (!category || !(category in LOG_CATEGORIES)) return '未分类'
  return LOG_CATEGORIES[category as keyof typeof LOG_CATEGORIES].label
}

/** 慢样本反查：按 traceId 找出同一链路的 user 事件，供性能视图跳转。 */
export function userEventForTrace(entries: readonly LogEntry[], traceId: string): LogEntry | null {
  const candidates = sortByTime(entries.filter((entry) => entry.traceId === traceId))
  return candidates.find((entry) => (entry.category ?? categoryFromLegacy(entry)) === 'user') ?? null
}
