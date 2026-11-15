/**
 * 性能样本解析与展示元数据。
 * 指标定义全部由 performanceContract 的注册表派生，本文件不再维护第二份 id 清单。
 */
import {
  PERFORMANCE_ACTION,
  PERFORMANCE_CATEGORIES,
  PERFORMANCE_METRIC_SPECS,
  resolvePerformanceMetricSpec,
  type PerformanceCategoryId,
  type PerformanceMetricId,
} from './performanceContract'

export interface PerformanceMetricDefinition {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  category: PerformanceCategoryId
  categoryLabel: string
  description: string
  sampleRate: number
}

/** 宿主 API 与监控页面共用的指标定义表；顺序即页面展示顺序。 */
export const PERFORMANCE_METRIC_DEFINITIONS: Record<PerformanceMetricId, PerformanceMetricDefinition> =
  Object.fromEntries(
    PERFORMANCE_METRIC_SPECS.map((spec) => [
      spec.id,
      {
        id: spec.id,
        label: spec.label,
        shortLabel: spec.shortLabel,
        color: PERFORMANCE_CATEGORIES[spec.category].color,
        thresholdMs: spec.thresholdMs,
        category: spec.category,
        categoryLabel: PERFORMANCE_CATEGORIES[spec.category].label,
        description: spec.description,
        sampleRate: spec.sampleRate,
      } satisfies PerformanceMetricDefinition,
    ]),
  ) as Record<PerformanceMetricId, PerformanceMetricDefinition>

export const PERFORMANCE_METRIC_DEFINITION_LIST: PerformanceMetricDefinition[] =
  PERFORMANCE_METRIC_SPECS.map((spec) => PERFORMANCE_METRIC_DEFINITIONS[spec.id])

export interface LogLikeEntry {
  id?: string
  timestamp?: string
  action?: string
  module?: string
  params?: unknown
}

export interface PerformanceSample {
  id: string
  metric: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  category: PerformanceCategoryId
  durationMs: number
  success: boolean
  timestamp: string
  timestampMs: number
  module?: string
  sessionId?: string
  source?: string
  traceId?: string
  params: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  // 旧日志可能把 params 存成 JSON 字符串；宿主反解与标定 CLI 共用这一层容错，
  // 否则这些行会因为取不到 metric 被整条丢掉。
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value) as unknown)
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return fallback
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * 从日志条目反解性能样本。日志仍是唯一持久化介质，因此这里必须容错：
 * 老日志没有 category/sessionId，注册表里已删除的指标也不能让整批样本消失。
 */
export function extractPerformanceSamples(entries: LogLikeEntry[]): PerformanceSample[] {
  return entries.flatMap((entry) => {
    if (entry.action !== PERFORMANCE_ACTION) return []
    const params = asRecord(entry.params)
    const metric = params.metric
    if (typeof metric !== 'string' || !metric) return []
    const durationMs = asNumber(params.durationMs)
    if (durationMs === null) return []

    const spec = resolvePerformanceMetricSpec(metric)
    const category = spec?.category ?? 'runtime'
    const categoryMeta = PERFORMANCE_CATEGORIES[category]
    const definition = spec ? PERFORMANCE_METRIC_DEFINITIONS[spec.id] : null
    const timestamp = entry.timestamp || new Date(0).toISOString()
    const timestampMs = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : 0

    return [{
      id: entry.id ?? `${metric}-${timestamp}-${durationMs}`,
      metric: metric as PerformanceMetricId,
      label: definition?.label ?? metric,
      shortLabel: definition?.shortLabel ?? metric.slice(0, 4),
      color: definition?.color ?? categoryMeta.color,
      thresholdMs: asNumber(params.thresholdMs) ?? definition?.thresholdMs ?? 1000,
      category,
      durationMs,
      success: asBoolean(params.success, true),
      timestamp,
      timestampMs,
      module: entry.module,
      sessionId: asString(params.sessionId),
      source: asString(params.source) ?? entry.module,
      traceId: asString(params.traceId),
      params,
    }]
  }).sort((a, b) => a.timestampMs - b.timestampMs)
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const clamped = Math.min(1, Math.max(0, p))
  const index = (sortedValues.length - 1) * clamped
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]
  const weight = index - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '0 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatSuccessRate(rate: number): string {
  if (!Number.isFinite(rate)) return '0%'
  return `${rate.toFixed(rate >= 99 ? 1 : 0)}%`
}

export function formatCompactDateTime(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  } catch {
    return timestamp
  }
}
