/**
 * 折叠子树计数的运行时广播层（P1.75，2026-11-09）。
 *
 * 【为什么不走节点 data / React context】
 *   - 计数是随镜头变化的**派生渲染信息**，写进 nodes[].data 要过 7 处字段白名单，
 *     还容易被 graphMapper / 落盘链路当成持久字段，违反「hidden 不落盘」；
 *   - context 的 value 每次可见性计划都会变 → 所有消费卡片一起重渲染，
 *     万级节点缩放必掉帧。
 * 这里按 scope（roomPath）隔离 + 按 nodeId **精确通知**：一次缩放只让计数真正
 * 变化的卡片重渲染，其余节点零重渲染，与 --tm-glyph-comp 的零重渲染策略一致。
 *
 * 全局单份是有依据的：App.tsx 里所有标签页常驻挂载，但 GraphPage.tsx 只有
 * isActive 的那一页渲染 <GraphCanvas>，同一时刻至多一个画布发布计数。
 * scope 参数用于切房间时把旧房间的计数整体作废，不会串到新房间的同名节点上。
 *
 * 纯运行时：不落盘、不进 localStorage、不写节点 / 边数据。
 */
type Listener = () => void

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map<string, number>()

let activeScope = ''
let activeCounts: ReadonlyMap<string, number> = EMPTY_COUNTS
const listeners = new Map<string, Set<Listener>>()

/** 只通知计数真的变了的节点，避免广播给全部可见卡片。 */
function notifyChanges(previous: ReadonlyMap<string, number>, next: ReadonlyMap<string, number>): void {
  const touched = new Set<string>([...previous.keys(), ...next.keys()])
  for (const id of touched) {
    if ((previous.get(id) ?? 0) === (next.get(id) ?? 0)) continue
    const set = listeners.get(id)
    if (!set) continue
    for (const listener of [...set]) listener()
  }
}

export function publishCollapsedCounts(scope: string, next: ReadonlyMap<string, number>): void {
  // 【顺序铁律】必须**先写快照、再通知**。useSyncExternalStore 的监听器会在通知
  // 当场调用 getSnapshot：若此时读到的还是旧值，React 会判定「快照没变」直接丢弃
  // 这次重渲染，徽标就永远停在旧计数上（缩放逐格变化的场景实测会漏更新）。
  // previous 用换房间前的旧快照，旧房间节点不在 next 里 → 自然被通知归零。
  const previous = activeCounts
  activeScope = scope
  activeCounts = next
  notifyChanges(previous, next)
}

export function clearCollapsedCounts(scope: string): void {
  if (scope !== activeScope) return
  const previous = activeCounts
  activeCounts = EMPTY_COUNTS
  notifyChanges(previous, EMPTY_COUNTS)
}

export function subscribeCollapsedCount(nodeId: string, listener: Listener): () => void {
  let set = listeners.get(nodeId)
  if (!set) {
    set = new Set<Listener>()
    listeners.set(nodeId, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(nodeId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(nodeId)
  }
}

/** useSyncExternalStore 的 getSnapshot 必须返回稳定值：这里返回数字，天然满足。 */
export function getCollapsedCount(nodeId: string): number {
  return activeCounts.get(nodeId) ?? 0
}
