/**
 * 页面挂起 / 后台隐藏导致的性能计时污染识别。
 *
 * 真实监控里出现过 `app_startup` 602842ms、`node_select` 1014915ms 的样本：
 * 标签页被切到后台、窗口最小化或系统休眠后，performance.now() 仍按单调时钟累加，
 * 恢复时一次性上报，把 P95 / 慢率彻底拉歪。`performanceStarts.ts` 的 TTL 只能挡住
 * 「跨会话残留的计时起点」，挡不住本次会话内的挂起。
 *
 * 判定分两层，都在统一上报层的入口完成，覆盖 span / measure / mark-take 全部路径：
 *   1) 绝对可信上限：超过 MAX_TRUSTED_SAMPLE_MS 的样本一律视为不可信；
 *   2) 可见性窗口：样本区间与 document 隐藏区间有重叠即视为不可信。
 *
 * 主体是零依赖纯函数，便于回归脚本用 esbuild 真跑；观察器只负责产出隐藏区间。
 */
/** 交互类指标的耗时上限；真实用户操作不会持续 5 分钟以上，超过必然是挂起/休眠。 */
export const MAX_TRUSTED_SAMPLE_MS = 5 * 60 * 1000

/** 只保留最近若干段隐藏区间，避免长期运行的页面里数组无限增长。 */
const MAX_TRACKED_INTERVALS = 32

export interface HiddenInterval {
  /** performance.now() 时间轴上的隐藏起点 */
  start: number
  /** 恢复可见的时刻；null 表示当前仍处于隐藏态 */
  end: number | null
}

/** 纯函数：样本窗口 [start, end] 被隐藏区间覆盖的毫秒数。 */
export function hiddenOverlapMs(
  start: number,
  end: number,
  intervals: readonly HiddenInterval[],
): number {
  if (!(end > start)) return 0
  let total = 0
  for (const interval of intervals) {
    const from = Math.max(start, interval.start)
    const to = Math.min(end, interval.end ?? Number.POSITIVE_INFINITY)
    if (to > from) total += to - from
  }
  return total
}

/** 纯函数：耗时本身是否无效（非有限值 / 负数）。批量 IO 也只做这一层校验。 */
export function isInvalidDuration(durationMs: number): boolean {
  return !Number.isFinite(durationMs) || durationMs < 0
}

/** 纯函数：该交互样本是否应作为「挂起污染」丢弃。 */
export function isSuspensionSample(
  durationMs: number,
  now: number,
  intervals: readonly HiddenInterval[] = [],
  maxTrustedMs = MAX_TRUSTED_SAMPLE_MS,
): boolean {
  if (isInvalidDuration(durationMs)) return true
  if (durationMs > maxTrustedMs) return true
  return hiddenOverlapMs(now - durationMs, now, intervals) > 0
}

// ============================================================
// 运行时观察器：把 visibilitychange 翻译成隐藏区间
// ============================================================

const hiddenIntervals: HiddenInterval[] = []
let detachObserver: (() => void) | null = null

export function getHiddenIntervals(): readonly HiddenInterval[] {
  return hiddenIntervals
}

/** 记录一段隐藏区间；同时供回归脚本注入场景，不依赖真实 DOM 事件。 */
export function recordHiddenInterval(start: number, end: number | null): void {
  hiddenIntervals.push({ start, end })
  if (hiddenIntervals.length > MAX_TRACKED_INTERVALS) hiddenIntervals.shift()
}

/**
 * 把「样本被丢弃」写成一条轻量诊断记录：不带 durationMs、显式 suspended 标记，
 * 统计侧还会二次过滤。这样既不污染监控看板，也保留「这段时间发生过挂起」的线索。
 */
export function buildSuspendedSampleParams(
  metric: string,
  durationMs: number,
  sessionId: string,
  source: string,
): Record<string, unknown> {
  return {
    metric,
    suspended: true,
    rawDurationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    sessionId,
    source,
  }
}

export function startSuspensionObserver(): () => void {
  if (detachObserver) return detachObserver
  if (typeof document === 'undefined' || typeof performance === 'undefined') return () => {}

  const onChange = () => {
    const now = performance.now()
    if (document.visibilityState === 'hidden') {
      recordHiddenInterval(now, null)
      return
    }
    for (let i = hiddenIntervals.length - 1; i >= 0; i -= 1) {
      if (hiddenIntervals[i].end === null) {
        hiddenIntervals[i].end = now
        break
      }
    }
  }

  // 启动瞬间就已处于后台时不会收到 visibilitychange，需要补一段开启中的区间。
  if (document.visibilityState === 'hidden') recordHiddenInterval(performance.now(), null)
  document.addEventListener('visibilitychange', onChange)
  detachObserver = () => {
    document.removeEventListener('visibilitychange', onChange)
    detachObserver = null
  }
  return detachObserver
}
