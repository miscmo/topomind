/**
 * Debug HUD 的纯数据层（P6 / D18）。
 *
 * 设计约束：
 * 1. 只依赖 LogEntry 的**类型**，运行时零依赖，便于 scripts/verify-logging.mts 的 C14
 *    直接以行为用例加载（与 logViewModel.ts 同一套路）。
 * 2. HUD 只持有内存环形缓冲（默认 300 条），不落盘、不写 console、不写日志——
 *    `log:write -> log:entry -> HUD` 若再回写就会自我放大。
 * 3. 实时推送按 80ms 合帧批量进入这里，避免高频日志每条触发一次 React 渲染。
 */
import type { LogEntry } from '../../shared/observability/logContract'

/** HUD 内存上限：只影响显示，不影响 log-service 的 2000 条主缓冲与落盘。 */
export const DEBUG_HUD_LIMIT = 300
export const DEBUG_HUD_MIN_LIMIT = 20
/** 实时流合帧窗口（毫秒）。 */
export const DEBUG_HUD_FLUSH_MS = 80
/** 暂停期间最多暂存的条数，避免长时间暂停吃内存。 */
export const DEBUG_HUD_PAUSE_LIMIT = DEBUG_HUD_LIMIT * 2

export const DEBUG_HUD_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const
export const DEBUG_HUD_CATEGORIES = ['user', 'internal', 'performance', 'error'] as const

export interface DebugHudFilters {
  /** 空数组表示不过滤（全显）。 */
  levels: readonly string[]
  categories: readonly string[]
  keyword: string
}

export const DEFAULT_DEBUG_FILTERS: DebugHudFilters = {
  levels: [],
  categories: [],
  keyword: '',
}

/** 实时流都是 v3 条目；v1/v2 读时兜底口径与 categoryFromLegacy 的保守版一致。 */
export function debugCategoryOf(entry: LogEntry): string {
  if (entry.category) return String(entry.category)
  return entry.level === 'ERROR' ? 'error' : 'internal'
}

export function debugLevelOf(entry: LogEntry): string {
  return entry.level ?? 'INFO'
}

/** timestamp + seq 与 log-service 的跨类合并同口径；seq 补零保证字典序即数值序。 */
function orderKey(entry: LogEntry): string {
  const seq = typeof entry.seq === 'number' ? entry.seq : 0
  return `${entry.timestamp ?? ''}#${String(seq).padStart(12, '0')}`
}

export function trimDebugEntries(
  entries: readonly LogEntry[],
  limit: number = DEBUG_HUD_LIMIT,
): LogEntry[] {
  const cap = Math.max(DEBUG_HUD_MIN_LIMIT, Math.floor(limit))
  return entries.length > cap ? entries.slice(entries.length - cap) : [...entries]
}

/**
 * 合并一批新条目：按时间归位后只保留最近 cap 条。
 * 开启 HUD 时会先补 log:getBuffer 的历史，再叠加实时推送，两者可能乱序到达。
 */
export function appendDebugEntries(
  current: readonly LogEntry[],
  incoming: readonly LogEntry[],
  limit: number = DEBUG_HUD_LIMIT,
): LogEntry[] {
  if (incoming.length === 0) return trimDebugEntries(current, limit)
  const merged = [...current, ...incoming]
  merged.sort((a, b) => {
    const ka = orderKey(a)
    const kb = orderKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return trimDebugEntries(merged, limit)
}

export function matchesDebugFilters(
  entry: LogEntry,
  filters: DebugHudFilters = DEFAULT_DEBUG_FILTERS,
): boolean {
  const levels = filters.levels ?? []
  const categories = filters.categories ?? []
  if (levels.length > 0 && !levels.includes(debugLevelOf(entry))) return false
  if (categories.length > 0 && !categories.includes(debugCategoryOf(entry))) return false
  const keyword = (filters.keyword ?? '').trim().toLowerCase()
  if (!keyword) return true
  const haystack = [
    entry.label,
    entry.message,
    entry.action,
    entry.module,
    entry.result,
    entry.outcome,
    entry.target?.label,
    entry.target?.id,
    entry.traceId,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase()
  return haystack.includes(keyword)
}

export interface DebugHudSummary {
  total: number
  errors: number
  warns: number
  byCategory: Record<string, number>
  lastAt: string
}

export function summarizeDebugEntries(entries: readonly LogEntry[]): DebugHudSummary {
  const byCategory: Record<string, number> = {}
  let errors = 0
  let warns = 0
  for (const entry of entries) {
    const category = debugCategoryOf(entry)
    byCategory[category] = (byCategory[category] ?? 0) + 1
    const level = debugLevelOf(entry)
    if (level === 'ERROR') errors += 1
    if (level === 'WARN') warns += 1
  }
  return {
    total: entries.length,
    errors,
    warns,
    byCategory,
    lastAt: entries.length > 0 ? (entries[entries.length - 1]?.timestamp ?? '') : '',
  }
}

/** trace 太长会挤掉正文；只显示尾段，hover/title 仍给全量。 */
export function shortTraceId(traceId: string | null | undefined): string {
  if (!traceId) return '—'
  const clean = traceId.replace(/^orphan:/, '')
  return clean.length <= 8 ? clean : clean.slice(-8)
}

/** formatTimestamp 是 `YYYY-MM-DD HH:mm:ss.SSS`；HUD 只要时钟段。 */
export function debugClock(iso: string | undefined): string {
  return iso && iso.length >= 23 ? iso.slice(11, 23) : '--:--:--.---'
}

export function debugEntryTitle(entry: LogEntry): string {
  return entry.label || entry.message || entry.action || '（无描述）'
}

const MAX_DETAIL_CHARS = 2000

/**
 * 详情只做展示格式化，不做脱敏改写：条目在 buildLogEntry / log-service 入口
 * 已经过二次脱敏；这里再截断长度，避免单条 params 把浮窗撑爆。
 */
export function debugEntryDetail(entry: LogEntry): string {
  const detail: Record<string, unknown> = {
    action: entry.action ?? null,
    module: entry.module ?? null,
    category: debugCategoryOf(entry),
    result: entry.result ?? null,
    outcome: entry.outcome ?? null,
    traceId: entry.traceId ?? null,
    spanId: entry.spanId ?? null,
    parentId: entry.parentId ?? null,
  }
  if (entry.params) detail.params = entry.params
  if (entry.meta) detail.meta = entry.meta
  if (entry.target) detail.target = entry.target
  if (entry.error) detail.error = entry.error
  if (entry.fingerprint) detail.fingerprint = entry.fingerprint
  if (entry.breadcrumbs?.length) detail.breadcrumbs = `${entry.breadcrumbs.length} 条`
  if (typeof entry.stepCount === 'number') detail.stepCount = entry.stepCount
  if (entry.steps?.length) detail.steps = entry.steps.map((step) => ({
    name: step.name,
    ...(step.outcome ? { outcome: step.outcome } : {}),
    ...(typeof step.durationMs === 'number' ? { durationMs: step.durationMs } : {}),
  }))
  if (typeof entry.repeatCount === 'number') detail.repeatCount = entry.repeatCount
  try {
    const text = JSON.stringify(detail, null, 2)
    return text.length > MAX_DETAIL_CHARS
      ? `${text.slice(0, MAX_DETAIL_CHARS)}\n…（已截断，完整内容请用系统日志页）`
      : text
  } catch {
    return '（详情无法序列化）'
  }
}
