/**
 * 长任务归因的时间窗口判定（零依赖纯函数）。
 *
 * `PerformanceObserver` 给的是长任务的 startTime，而业务操作样本要到**操作结束**
 * 才上报，所以「长任务发生在操作执行期间」时，样本的 at 反而晚于长任务 startTime。
 * 旧实现按单值 + `at <= now` 匹配，实测 3463 条 long_task 里 2215 条归因落空。
 *
 * 这里以「操作起点」为严格下界、「样本上报时刻 + TTL」为上界，并在窗口内挑
 * 耗时最大的操作作为最可能的触发者：既覆盖执行期内的长任务，也不会让 1ms 的
 * meta_build / lod_recompute 把真正的重操作挤掉。抽成纯函数便于回归脚本真跑。
 */
export interface RecentOperation {
  metric: string
  contextKey: string
  /** 样本上报时刻，performance.now() 时间轴 */
  at: number
  /** 操作自身耗时，用于还原起点并比较「分量」 */
  durationMs: number
}

export const RECENT_CONTEXT_TTL_MS = 2000
export const MAX_RECENT_OPERATIONS = 64

/** 在窗口内挑出最可能引发长任务的操作；无匹配返回 null。 */
export function resolveRecentContext(
  at: number,
  operations: readonly RecentOperation[],
  ttlMs = RECENT_CONTEXT_TTL_MS,
): RecentOperation | null {
  let best: RecentOperation | null = null
  for (const item of operations) {
    const startedAt = item.at - item.durationMs
    // 下界严格取操作起点：长任务的 startTime 不可能早于引发它的操作。
    // 上界留 TTL 容差，覆盖「操作刚结束、长任务回调才送达」的异步延迟。
    if (at < startedAt || at > item.at + ttlMs) continue
    if (!best || item.durationMs > best.durationMs) best = item
  }
  return best
}

/**
 * 返回应从头丢弃的过期项数量（数组按 at 递增追加）。
 * 精确窗口判定交给 resolveRecentContext，这里只做内存上限的粗清理。
 */
export function countExpiredOperations(
  operations: readonly RecentOperation[],
  at: number,
  ttlMs = RECENT_CONTEXT_TTL_MS,
): number {
  let count = 0
  while (count < operations.length && at - operations[count].at > ttlMs * 2) count += 1
  return count
}
