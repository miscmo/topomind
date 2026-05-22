import { PERFORMANCE_ACTION, PERFORMANCE_METRICS, type PerformanceMetricId } from '../../core/performance-log'
import type { LogEntry } from '../../stores/monitorStore'

export interface PerformanceMetricDefinition {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
}

export const PERFORMANCE_METRIC_DEFINITIONS: Record<PerformanceMetricId, PerformanceMetricDefinition> = {
  [PERFORMANCE_METRICS.roomLoad]: {
    id: PERFORMANCE_METRICS.roomLoad,
    label: '房间加载',
    shortLabel: '加载',
    color: '#3b82f6',
    thresholdMs: 400,
  },
  [PERFORMANCE_METRICS.nodeSelect]: {
    id: PERFORMANCE_METRICS.nodeSelect,
    label: '节点选中响应',
    shortLabel: '选中',
    color: '#10b981',
    thresholdMs: 150,
  },
  [PERFORMANCE_METRICS.detailRead]: {
    id: PERFORMANCE_METRICS.detailRead,
    label: '详情文档读取',
    shortLabel: '读取',
    color: '#8b5cf6',
    thresholdMs: 200,
  },
  [PERFORMANCE_METRICS.detailSave]: {
    id: PERFORMANCE_METRICS.detailSave,
    label: '详情文档保存',
    shortLabel: '保存',
    color: '#f59e0b',
    thresholdMs: 300,
  },
}

export interface PerformanceSample {
  id: string
  metric: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  durationMs: number
  success: boolean
  timestamp: string
  timestampMs: number
  module?: string
  params: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
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

export function extractPerformanceSamples(entries: LogEntry[]): PerformanceSample[] {
  return entries.flatMap((entry) => {
    if (entry.action !== PERFORMANCE_ACTION) return []
    const params = asRecord(entry.params)
    const metric = params.metric
    if (typeof metric !== 'string' || !(metric in PERFORMANCE_METRIC_DEFINITIONS)) return []
    const durationMs = asNumber(params.durationMs)
    if (durationMs === null) return []
    const definition = PERFORMANCE_METRIC_DEFINITIONS[metric as PerformanceMetricId]
    const timestamp = entry.timestamp || new Date(0).toISOString()
    const timestampMs = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : 0

    return [{
      id: entry.id ?? `${metric}-${timestamp}-${durationMs}`,
      metric: definition.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      color: definition.color,
      thresholdMs: definition.thresholdMs,
      durationMs,
      success: asBoolean(params.success, true),
      timestamp,
      timestampMs,
      module: entry.module,
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
