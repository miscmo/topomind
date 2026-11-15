/**
 * 统一性能埋点上报层。
 *
 * 上报链路：业务代码 → 本文件 → logWrite(性能:记录) → IPC → Electron LogService
 *   → 按日落盘 JSON Lines + 环形缓冲 + log:entry 实时推送
 *   → extractPerformanceSamples 反解样本 → 监控页面统计。
 *
 * 业务代码只用 startPerformanceSpan / measurePerformance / recordPerformance，
 * 不自己算 performance.now()，也不自己拼 success / sessionId / source。
 * 旧的 mark / take / logPerformanceMetric 仍保留，避免历史调用点被迫改写。
 */
import {
  PERFORMANCE_ACTION,
  PERFORMANCE_METRICS,
  canvasOperationThreshold,
  resolvePerformanceMetricSpec,
  thresholdForScale,
  type PerformanceLogParams,
  type PerformanceMetricId,
} from '@/shared/observability/performanceContract'
import { logWrite } from './log-backend'

export { PERFORMANCE_ACTION, PERFORMANCE_METRICS }
export type { PerformanceLogParams, PerformanceMetricId }

/** 一次渲染进程会话的标识；重启后变化，页面可以据此判断样本是否跨会话。 */
export const PERFORMANCE_SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

let traceSequence = 0

/** 生成一次用户操作的链路 id；同一次操作的主样本与后台子样本共用它。 */
export function newPerformanceTraceId(scope = 'canvas'): string {
  traceSequence += 1
  return `${scope}:${PERFORMANCE_SESSION_ID}:${traceSequence}`
}

const performanceMetricStarts = new Map<string, number>()
const lastReportAt = new Map<string, number>()

function getMetricStartKey(metric: PerformanceMetricId, contextKey = 'default'): string {
  return `${metric}:${contextKey}`
}

/** 旧契约：跨模块传递计时起点（React 渲染会打断同步调用链）。 */
export function markPerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): void {
  performanceMetricStarts.set(getMetricStartKey(metric, contextKey), performance.now())
}

/** 旧契约：取出并删除计时起点。 */
export function takePerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): number | null {
  const key = getMetricStartKey(metric, contextKey)
  const startedAt = performanceMetricStarts.get(key)
  if (startedAt === undefined) return null
  performanceMetricStarts.delete(key)
  return startedAt
}

export interface PerformanceReportOptions {
  success?: boolean
  params?: Record<string, unknown>
  module?: string
  traceId?: string
  contextKey?: string
  /** 失败样本与关键指标可跳过采样/节流，保证不丢异常。 */
  force?: boolean
}

/**
 * 采样与节流：按注册表里的 sampleRate / minIntervalMs 控制高频指标噪音。
 * 失败样本永远上报，避免「越慢越看不见」；超过（按 operation 细分的）阈值的
 * 慢样本也必须绕过节流，否则连续慢操作会被合并掉，恰好丢掉最需要排查的数据。
 * 未注册的 id 直接拒绝，防止指标漂移。
 */
function shouldReport(
  metric: PerformanceMetricId,
  options: PerformanceReportOptions,
  durationMs: number,
  thresholdMs: number,
  now: number,
): boolean {
  const spec = resolvePerformanceMetricSpec(metric)
  if (!spec) return false
  if (options.force || options.success === false) return true
  if (durationMs > thresholdMs) return true
  if (spec.sampleRate < 1 && Math.random() >= spec.sampleRate) return false
  if (spec.minIntervalMs > 0) {
    const previous = lastReportAt.get(metric)
    if (previous !== undefined && now - previous < spec.minIntervalMs) return false
  }
  return true
}

async function writePerformanceSample(
  metric: PerformanceMetricId,
  durationMs: number,
  options: PerformanceReportOptions,
): Promise<boolean> {
  const now = performance.now()
  const spec = resolvePerformanceMetricSpec(metric)
  const operation = typeof options.params?.operation === 'string' ? options.params.operation : ''
  const nodeCount = typeof options.params?.nodeCount === 'number' ? options.params.nodeCount : 0
  const baseThreshold = canvasOperationThreshold(operation) ?? spec?.thresholdMs ?? Number.POSITIVE_INFINITY
  // 全量构建 / LOD 重算等 O(N) 动作按节点数放宽阈值；交互类保持固定阈值。
  const thresholdMs = thresholdForScale(baseThreshold, nodeCount, operation)
  if (!shouldReport(metric, options, durationMs, thresholdMs, now)) return false
  lastReportAt.set(metric, now)

  const success = options.success !== false
  const roundedDuration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
  const params: Record<string, unknown> = {
    ...options.params,
    metric,
    durationMs: roundedDuration,
    success,
    sessionId: PERFORMANCE_SESSION_ID,
    source: options.module ?? 'App',
  }
  // 让页面反解出的 thresholdMs 与「该 operation 的慢判定」一致，统计口径不分叉。
  if (operation) params.thresholdMs = thresholdMs
  if (spec) params.category = spec.category
  if (options.traceId) params.traceId = options.traceId
  if (options.contextKey) params.contextKey = options.contextKey

  return logWrite({
    level: success ? 'INFO' : 'WARN',
    module: options.module ?? 'Performance',
    action: PERFORMANCE_ACTION,
    message: `${metric} ${roundedDuration}ms${success ? '' : ' failed'}`,
    params,
  })
}

/** 直接上报一次已算好的耗时；fire-and-forget，不阻塞调用方。 */
export function recordPerformance(
  metric: PerformanceMetricId,
  durationMs: number,
  options: PerformanceReportOptions = {},
): void {
  void writePerformanceSample(metric, durationMs, options)
}

/** 旧契约：返回 Promise<boolean>，语义与历史实现一致。 */
export async function logPerformanceMetric(
  metric: PerformanceMetricId,
  durationMs: number,
  params: Omit<PerformanceLogParams, 'metric' | 'durationMs'> = {},
  module = 'Performance',
): Promise<boolean> {
  const { success, traceId, contextKey, ...rest } = params
  return writePerformanceSample(metric, durationMs, {
    success: typeof success === 'boolean' ? success : undefined,
    params: rest,
    module,
    traceId: typeof traceId === 'string' ? traceId : undefined,
    contextKey: typeof contextKey === 'string' ? contextKey : undefined,
  })
}

export interface PerformanceSpan {
  readonly metric: PerformanceMetricId
  /** 合并额外上下文并上报成功；重复调用只生效一次。 */
  end(extra?: Record<string, unknown>): void
  /** 上报失败并带上错误信息；重复调用只生效一次。 */
  fail(error: unknown, extra?: Record<string, unknown>): void
}

/**
 * 手动 span：适用于「起点和终点不在同一个函数」或去重判断分支很多的链路。
 * 用法：const span = startPerformanceSpan(METRIC, { params: {...} }); ... span.end()
 */
export function startPerformanceSpan(
  metric: PerformanceMetricId,
  options: Omit<PerformanceReportOptions, 'success'> = {},
): PerformanceSpan {
  const startedAt = performance.now()
  let settled = false
  const finish = (success: boolean, extra?: Record<string, unknown>) => {
    if (settled) return
    settled = true
    recordPerformance(metric, performance.now() - startedAt, {
      ...options,
      success,
      params: { ...options.params, ...extra },
    })
  }
  return {
    metric,
    end: (extra) => finish(true, extra),
    fail: (error, extra) => finish(false, {
      ...extra,
      error: error instanceof Error ? error.message : String(error),
    }),
  }
}

/**
 * 包装一次同步/异步操作：自动计时、自动判定成功失败、异常原样抛出。
 * 这是新埋点的首选入口，业务函数体一行都不用改结构。
 */
export async function measurePerformance<T>(
  metric: PerformanceMetricId,
  task: () => T | Promise<T>,
  options: PerformanceReportOptions = {},
): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await task()
    recordPerformance(metric, performance.now() - startedAt, { ...options, success: true })
    return result
  } catch (error) {
    recordPerformance(metric, performance.now() - startedAt, {
      ...options,
      success: false,
      params: {
        ...options.params,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}
