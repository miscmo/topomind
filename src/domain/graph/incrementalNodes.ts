/**
 * 节点增量更新：只给真正变化的节点换引用，其余保持原引用。
 *
 * 【为什么可以缓存 id→index】
 * 旧实现每次调用都从 `nodes` 重建全量 Map（O(N)），理由是「store 级索引可能
 * 在 load / undo 后过期，会让变更被静默跳过」。这里改成按**数组引用**缓存：
 *   - 索引始终由传入的 `nodes` 真实构建，不是跨状态的持久索引，不存在过期；
 *   - `nextNodes = nodes.slice()` 保持顺序不变，因此把同一份索引登记到新数组上，
 *     下一帧（以及 graphStore.setNodesPreservingSelection）可直接命中，O(changed)；
 *   - 换房间 / undo / 任何外部构造的新数组都没有缓存记录，自动回退到重建，
 *     绝不会静默跳过变更。
 *
 * 这样框选 / 拖拽的连续帧里，全图 Map 构建从每帧一次降为整个会话一次。
 */
export interface NodeIndexCache<T extends { id: string }> {
  indexFor(nodes: readonly T[]): Map<string, number>
  remember(nodes: readonly T[], index: Map<string, number>): void
}

export function createNodeIndexCache<T extends { id: string }>(): NodeIndexCache<T> {
  const cache = new WeakMap<readonly T[], Map<string, number>>()
  return {
    indexFor(nodes) {
      const hit = cache.get(nodes)
      if (hit) return hit
      const built = new Map<string, number>()
      for (let i = 0; i < nodes.length; i += 1) built.set(nodes[i].id, i)
      cache.set(nodes, built)
      return built
    },
    remember(nodes, index) {
      cache.set(nodes, index)
    },
  }
}

export interface IncrementalNodesResult<T> {
  nextNodes: T[]
  changedIds: string[]
  /** 变化后的新节点对象，供 store 增量刷新 nodesMap，避免再扫一遍全图。 */
  changedNodes: T[]
}

export function computeIncrementalNodes<T extends { id: string }, C>(
  nodes: readonly T[],
  changesById: Map<string, C>,
  apply: (node: T, change: C) => { changed: boolean; node: T },
  cache: NodeIndexCache<T>,
): IncrementalNodesResult<T> | null {
  const nodeIndexById = cache.indexFor(nodes)
  const changedIds: string[] = []
  const changedNodes: T[] = []
  for (const [id, change] of changesById) {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) continue
    const result = apply(nodes[idx], change)
    if (!result.changed) continue
    changedIds.push(id)
    changedNodes.push(result.node)
  }
  if (changedIds.length === 0) return null
  const nextNodes = nodes.slice()
  for (let i = 0; i < changedIds.length; i += 1) {
    const idx = nodeIndexById.get(changedIds[i])
    if (idx !== undefined) nextNodes[idx] = changedNodes[i]
  }
  // slice 保持顺序：新旧数组共享同一份 id→index，下一帧直接命中缓存。
  cache.remember(nextNodes, nodeIndexById)
  return { nextNodes, changedIds, changedNodes }
}
