/**
 * 「选中子树」：以一个或多个选中节点为根，沿**从属边**向下把整棵子树选中。
 *
 * 【为什么复用 buildHierarchy】树只有一套规则：source=父 → target=子、唯一父、
 * 无环、深度 ≤100、违规边降级为 related。LOD 与深度诊断都用它，若这里另写一遍
 * BFS 深度推断，遇到脏数据（多父 / 环 / 超深）就会出现「界面上是一棵树、选中
 * 时是另一棵树」。投影方式与 lod.ts 的 projectEdges 完全一致（含旧关系值兼容），
 * 也不传 weight，保证选中的就是用户当前看到的那棵树。
 *
 * 【范围】根自身算子树的一部分；related 边、游离节点、非法从属边都不进结果。
 * 选中是**替换式**的：多个根取子树并集，原先选中的无关节点会被取消，
 * 这样「选中子树」的结果就是可预期的一整棵（或多棵）子树，便于接着批量操作。
 *
 * 【性能】只在点击菜单 / 右键时跑一次 O(节点+边)；纯函数不碰 store、DOM、落盘，
 * 不改节点/边字段白名单，未变更节点保持原引用，可 esbuild 打包真跑。
 */
import { buildHierarchy, toHierarchyEdge } from './graphHierarchy.ts'
import { isSubordinate, readEdgeRelationId } from './edgeRelations.ts'

export interface SubtreeNodeLike {
  id: string
  selected?: boolean
}

/** 渲染层把 relation 放在 data 上，磁盘边放在顶层，两者都兼容。 */
export interface SubtreeEdgeLike {
  id?: unknown
  source?: unknown
  target?: unknown
  relation?: unknown
  data?: { relation?: unknown } | null
}

export interface SubtreeSelectionPatch<T extends SubtreeNodeLike> {
  nodes: T[]
  /** 子树节点 id（含根），顺序稳定：按 rootIds 顺序、逐层 BFS */
  subtreeIds: string[]
  /** 本次新加入选中的 id */
  addedIds: string[]
  /** 选中态是否真的发生变化（连点两次第二次为 false） */
  changed: boolean
}

function projectSubtreeEdges(edges: readonly SubtreeEdgeLike[]) {
  return edges.map((edge) => toHierarchyEdge({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: readEdgeRelationId(edge.relation ?? edge.data?.relation),
  }))
}

/**
 * 收集 rootIds 各自子树的全部节点 id（含根）。
 * 脏 id / 重复 id / 成环数据都不会让结果发散；返回值只含真实存在的节点。
 */
export function collectSubtreeNodeIds(
  nodes: readonly SubtreeNodeLike[],
  edges: readonly SubtreeEdgeLike[],
  rootIds: readonly string[],
): string[] {
  const knownIds = new Set(nodes.map((node) => node.id))
  const roots: string[] = []
  const seenRoots = new Set<string>()
  for (const id of rootIds) {
    if (!knownIds.has(id) || seenRoots.has(id)) continue
    seenRoots.add(id)
    roots.push(id)
  }
  if (roots.length === 0) return []

  // 只把从属边交给树校验器：related 边与降级边天然被过滤掉。
  const subordinateEdges = projectSubtreeEdges(edges).filter((edge) => isSubordinate(edge.relation))
  const { hierarchy } = buildHierarchy([...knownIds], subordinateEdges)

  const result: string[] = []
  const seen = new Set<string>()
  const queue = [...roots]
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i]
    if (seen.has(id) || !knownIds.has(id)) continue
    seen.add(id)
    result.push(id)
    for (const child of hierarchy.children.get(id) ?? []) {
      if (!seen.has(child)) queue.push(child)
    }
  }
  return result
}

/** 产出可以整批写回 store 的选中补丁；rootIds 为空或全是脏 id 时返回 null。 */
export function applySubtreeSelection<T extends SubtreeNodeLike>(
  nodes: readonly T[],
  edges: readonly SubtreeEdgeLike[],
  rootIds: readonly string[],
): SubtreeSelectionPatch<T> | null {
  const subtreeIds = collectSubtreeNodeIds(nodes, edges, rootIds)
  if (subtreeIds.length === 0) return null
  const target = new Set(subtreeIds)
  const addedIds: string[] = []
  let changed = false
  const nextNodes = nodes.map((node) => {
    const shouldSelect = target.has(node.id)
    const wasSelected = Boolean(node.selected)
    if (shouldSelect && !wasSelected) addedIds.push(node.id)
    if (wasSelected === shouldSelect) return node
    changed = true
    return { ...node, selected: shouldSelect }
  })
  return { nodes: nextNodes, subtreeIds, addedIds, changed }
}
