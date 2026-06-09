import { logWrite } from './log-backend'

export const PERFORMANCE_ACTION = '性能:记录'

export const PERFORMANCE_METRICS = {
  roomLoad: 'room_load',
  nodeSelect: 'node_select',
  detailRead: 'detail_read',
  detailSave: 'detail_save',
} as const

export type PerformanceMetricId = typeof PERFORMANCE_METRICS[keyof typeof PERFORMANCE_METRICS]

export interface PerformanceLogParams extends Record<string, unknown> {
  metric: PerformanceMetricId
  durationMs: number
  success?: boolean
}

const performanceMetricStarts = new Map<string, number>()

function getMetricStartKey(metric: PerformanceMetricId, contextKey = 'default'): string {
  return `${metric}:${contextKey}`
}

export function markPerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): void {
  performanceMetricStarts.set(getMetricStartKey(metric, contextKey), performance.now())
}

export function takePerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): number | null {
  const key = getMetricStartKey(metric, contextKey)
  const startedAt = performanceMetricStarts.get(key)
  if (startedAt === undefined) return null
  performanceMetricStarts.delete(key)
  return startedAt
}

export async function logPerformanceMetric(
  metric: PerformanceMetricId,
  durationMs: number,
  params: Omit<PerformanceLogParams, 'metric' | 'durationMs'> = {},
  module = 'Performance'
): Promise<boolean> {
  const roundedDuration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
  const success = params.success !== false

  return logWrite({
    level: success ? 'INFO' : 'WARN',
    module,
    action: PERFORMANCE_ACTION,
    message: `${metric} ${roundedDuration}ms${success ? '' : ' failed'}`,
    params: {
      metric,
      durationMs: roundedDuration,
      success,
      ...params,
    },
  })
}
