/**
 * 跨模块计时起点的存储与消费（旧 mark / take 契约）。
 *
 * 起点写在 `performance-log.ts` 的模块级 Map 里，但消费方是右栏的异步 effect：
 * 点击已选中的节点、右键未改选中、右栏未激活等路径都会留下**未被消费**的起点。
 * 若不设有效期，几天后再次选中同一个 nodeId 会取到几天前的时间戳，
 * 产出「缓存命中却耗时 9 小时」的假慢样本，把整个看板的 P95/P99 污染掉。
 *
 * 这里做成零依赖纯函数，便于回归脚本用 esbuild 真跑 TTL 行为。
 */
export const PERFORMANCE_START_TTL_MS = 1000

export interface PendingPerformanceStart {
  startedAt: number
}

/** 清理所有过期起点，避免未被消费的 key 无限堆积。 */
export function pruneStaleStarts(
  starts: Map<string, PendingPerformanceStart>,
  now: number,
  ttlMs = PERFORMANCE_START_TTL_MS,
): void {
  for (const [key, value] of starts) {
    if (now - value.startedAt > ttlMs) starts.delete(key)
  }
}

/**
 * 取出并**始终删除**起点；超过 TTL 的一律视为残留，返回 null 让调用方降级为
 * 「从当前 effect 重新计时」，绝不把陈旧时间戳混进耗时。
 */
export function consumeStart(
  starts: Map<string, PendingPerformanceStart>,
  key: string,
  now: number,
  ttlMs = PERFORMANCE_START_TTL_MS,
): number | null {
  const entry = starts.get(key)
  if (entry === undefined) return null
  starts.delete(key)
  if (now - entry.startedAt > ttlMs) return null
  return entry.startedAt
}
