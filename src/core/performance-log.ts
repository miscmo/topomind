import { PERFORMANCE_ACTION, PERFORMANCE_METRICS, type PerformanceLogParams, type PerformanceMetricId } from '@/shared/observability/performanceContract'
import { logWrite } from './log-backend'

export { PERFORMANCE_ACTION, PERFORMANCE_METRICS }
export type { PerformanceLogParams, PerformanceMetricId }

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
