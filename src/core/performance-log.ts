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
import {
  consumeStart,
  pruneStaleStarts,
  type PendingPerformanceStart,
} from '@/shared/observability/performanceStarts'

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

const performanceMetricStarts = new Map<string, PendingPerformanceStart>()
const lastReportAt = new Map<string, number>()

/**
 * 自动观测指标（long_task）的归因上下文。只记「有分量」的操作，
 * 避免 detail_save 这类高频短样本把最近上下文刷成无关指标。
 */
const RECENT_CONTEXT_MIN_MS = 50
const RECENT_CONTEXT_TTL_MS = 2000
let recentOperation: { metric: string; contextKey: string; at: number } | null = null

/** 返回最近 2 秒内最可能引发长任务的操作；供 PerformanceObserver 写进 contextKey。 */
export function getRecentPerformanceContext(): { metric: string; contextKey: string } | null {
  if (!recentOperation || performance.now() - recentOperation.at > RECENT_CONTEXT_TTL_MS) return null
  return { metric: recentOperation.metric, contextKey: recentOperation.contextKey }
}

function getMetricStartKey(metric: PerformanceMetricId, contextKey = 'default'): string {
  return `${metric}:${contextKey}`
}

/**
 * 旧契约：跨模块传递计时起点（React 渲染会打断同步调用链）。
 * 写入前先清理过期起点，避免未消费的 key 长期堆积。
 */
export function markPerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): void {
  const now = performance.now()
  pruneStaleStarts(performanceMetricStarts, now)
  performanceMetricStarts.set(getMetricStartKey(metric, contextKey), { startedAt: now })
}

/**
 * 旧契约：取出并删除计时起点。
 * 陈旧起点（> PERFORMANCE_START_TTL_MS）一律丢弃：它是上一次未被消费的点击残留，
 * 不是本次交互的耗时。TTL 之外的真实卡顿应由 startPerformanceSpan 覆盖。
 */
export function takePerformanceMetricStart(metric: PerformanceMetricId, contextKey = 'default'): number | null {
  return consumeStart(
    performanceMetricStarts,
    getMetricStartKey(metric, contextKey),
    performance.now(),
  )
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
  if (metric !== PERFORMANCE_METRICS.longTask
    && Number.isFinite(durationMs)
    && durationMs >= RECENT_CONTEXT_MIN_MS) {
    const roomPath = typeof options.params?.roomPath === 'string' ? options.params.roomPath : ''
    recentOperation = {
      metric,
      contextKey: options.contextKey || roomPath || operation || metric,
      at: now,
    }
  }
  const nodeCount = typeof options.params?.nodeCount === 'number' ? options.params.nodeCount : 0
  const baseThreshold = canvasOperationThreshold(operation) ?? spec?.thresholdMs ?? Number.POSITIVE_INFINITY
  // 批量 O(N) 动作按节点数放宽阈值；交互类与实测不随规模增长的
  // meta_build / meta_flush / lod_recompute 保持固定阈值（见契约里的真实标定结论）。
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
