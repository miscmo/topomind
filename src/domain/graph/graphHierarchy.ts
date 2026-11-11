/**
 * 从属关系树：纯函数层（无 DOM / 无 store / 无 IPC，供 esbuild 打包真跑）。
 *
 * 【方向铁律】从属边 **source = 父，target = 子**，父指向子。
 * 深度自动推导：`depth(child) = depth(parent) + 1`，树根与游离节点深度为 1，
 * 上限 `MAX_HIERARCHY_DEPTH = 100`。深度是**派生量、不落盘**，权威始终是
 * `_graph.json` 里 edges 上的 relation；本模块产出的索引丢了可以全文重建。
 *
 * 【为什么不用每次遍历全树】深度单调不变量：祖先链上深度严格递减。
 * 加一条 P→C 的从属边成环，当且仅当 C 是 P 的祖先，此时必有
 * `depth(P) > depth(C)`。所以：
 *   - `depth(P) <= depth(C)` → 绝不可能是环，O(1) 直接接受；
 *   - 否则沿 parentEdge 向上走，走到 `depth <= depth(C)` 还没遇到 C 就停，
 *     步数 ≤ 99。
 * 日常往深层 / 平级挂节点几乎全是 O(1)，不需要并查集（删边/改关系无法
 * 高效维护 DSU，图谱编辑频繁反而要整体重建）。
 *
 * 【降级而非删除】已有违规边（多父 / 环 / 深度超限）统一把 relation 改成
 * `related`，边本身、两端、样式字段全部保留，节点数与边数迁移前后严格相等。
 *
 * 【游离节点】用户定义「没有任何强关系指向它」＝最边缘。但树根同样没有入边，
 * 所以必须区分：`无入边 且 有出边` → 树根（LOD 最高优先级保留）；
 * `无入边 且 无从属出边` → 游离（LOD 最先隐藏）。否则一缩小整棵树连根消失。
 */
import {
  DEFAULT_EDGE_RELATION_ID,
  SUBORDINATE_EDGE_RELATION_ID,
  isSubordinate,
  readEdgeRelationId,
} from './edgeRelations.ts'
import type { EdgeRelation } from '../../types'

export const MAX_HIERARCHY_DEPTH = 100
export const SUBORDINATE_EDGE_DIRECTION = 'source=parent,target=child'

export type TreeDowngradeReason = 'self-loop' | 'multiple-parents' | 'cycle' | 'depth-limit'

export interface HierarchyEdgeLike {
  id: string
  /** 父节点 id（从属边方向铁律） */
  source: string
  /** 子节点 id */
  target: string
  relation?: string
  weight?: string
}

export interface GraphHierarchy {
  /** 全量节点（nodeIds ∪ 边端点） */
  nodes: string[]
  /** child → 生效的从属边 */
  parentEdge: Map<string, HierarchyEdgeLike>
  /** parent → children（只含从属边） */
  children: Map<string, string[]>
  /** node → 深度（1~100） */
  depth: Map<string, number>
  /** 树根：无入边且有从属出边 */
  roots: string[]
  /** 游离节点：既无从属父、也无从属子 */
  free: string[]
  subordinateEdges: HierarchyEdgeLike[]
}

export interface TreeDowngrade {
  edgeId: string
  source: string
  target: string
  reason: TreeDowngradeReason
}

export interface HierarchyBuildResult {
  hierarchy: GraphHierarchy
  downgrades: TreeDowngrade[]
}

export interface SubordinateEdgeValidation {
  ok: boolean
  reason?: TreeDowngradeReason
}

export interface NormalizeTreeResult<T extends HierarchyEdgeLike> {
  edges: T[]
  downgrades: TreeDowngrade[]
  hierarchy: GraphHierarchy
}

function edgeEndpoint(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const ref = (value as { ref?: unknown }).ref
    if (typeof ref === 'string') return ref
  }
  return ''
}

/** 把任意形态的边（渲染层 KnowledgeEdge / 磁盘原始边）投影成本模块的纯形状。 */
export function toHierarchyEdge(raw: {
  id?: unknown
  source?: unknown
  target?: unknown
  relation?: unknown
  weight?: unknown
}): HierarchyEdgeLike {
  return {
    id: String(raw.id ?? ''),
    source: edgeEndpoint(raw.source),
    target: edgeEndpoint(raw.target),
    relation: typeof raw.relation === 'string' ? raw.relation : undefined,
    weight: typeof raw.weight === 'string' ? raw.weight : undefined,
  }
}

function createHierarchy(nodeIds: readonly string[], edges: readonly HierarchyEdgeLike[]): GraphHierarchy {
  const nodes = new Set<string>(nodeIds)
  for (const edge of edges) {
    if (edge.source) nodes.add(edge.source)
    if (edge.target) nodes.add(edge.target)
  }
  const list = [...nodes]
  return {
    nodes: list,
    parentEdge: new Map(),
    children: new Map(),
    // 所有节点初始深度 1；随后 attach 会从父往下重算。
    depth: new Map(list.map((id) => [id, 1])),
    roots: [],
    free: [],
    subordinateEdges: [],
  }
}

function refreshRootsAndFree(h: GraphHierarchy): void {
  const roots: string[] = []
  const free: string[] = []
  for (const id of h.nodes) {
    if (h.parentEdge.has(id)) continue
    if ((h.children.get(id)?.length ?? 0) > 0) roots.push(id)
    else free.push(id)
  }
  h.roots = roots
  h.free = free
}

/** 从 root 往下最长层数（root 自身算 1）。树无环，仍用 seen 兜底防御脏数据。 */
function subtreeSpan(h: GraphHierarchy, root: string): number {
  let max = 1
  const seen = new Set<string>()
  const stack: Array<[string, number]> = [[root, 1]]
  while (stack.length > 0) {
    const [node, level] = stack.pop()!
    if (seen.has(node)) continue
    seen.add(node)
    if (level > max) max = level
    for (const child of h.children.get(node) ?? []) stack.push([child, level + 1])
  }
  return max
}

/**
 * 增量校验一条**待新增**的从属边。h 是当前（已合规）树的索引。
 * 返回值带具体拒绝原因，UI 与迁移脚本共用，避免两处各写一套规则。
 */
export function validateSubordinateEdge(
  h: GraphHierarchy,
  edge: HierarchyEdgeLike,
): SubordinateEdgeValidation {
  const parent = edge.source
  const child = edge.target
  if (!parent || !child) return { ok: false, reason: 'self-loop' }
  if (parent === child) return { ok: false, reason: 'self-loop' }
  // 唯一父：一个节点只能从属于一个节点。
  if (h.parentEdge.has(child)) return { ok: false, reason: 'multiple-parents' }

  const dParent = h.depth.get(parent) ?? 1
  const dChild = h.depth.get(child) ?? 1

  // 深度单调不变量：祖先链深度严格递减，P 深度不大于 C 就不可能是 C 的后代 → 无环。
  if (dParent > dChild) {
    let cursor: string | undefined = parent
    let steps = 0
    while (cursor && steps <= MAX_HIERARCHY_DEPTH) {
      if (cursor === child) return { ok: false, reason: 'cycle' }
      const d = h.depth.get(cursor) ?? 1
      if (d <= dChild) break
      cursor = h.parentEdge.get(cursor)?.source
      steps += 1
    }
  }

  // 加边后 child 的新深度 = dParent + 1；其子树最深 = dParent + subtreeSpan(child)。
  if (dParent + subtreeSpan(h, child) > MAX_HIERARCHY_DEPTH) {
    return { ok: false, reason: 'depth-limit' }
  }
  return { ok: true }
}

/** 把一条已校验的从属边挂进索引，并只重算受影响子树的深度。 */
function attach(h: GraphHierarchy, edge: HierarchyEdgeLike): void {
  h.parentEdge.set(edge.target, edge)
  const kids = h.children.get(edge.source)
  if (kids) kids.push(edge.target)
  else h.children.set(edge.source, [edge.target])
  h.subordinateEdges.push(edge)

  const seen = new Set<string>()
  const stack = [edge.source]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (seen.has(node)) continue
    seen.add(node)
    const d = h.depth.get(node) ?? 1
    for (const child of h.children.get(node) ?? []) {
      h.depth.set(child, d + 1)
      stack.push(child)
    }
  }
}

/** 稳定顺序：weight==='main' 优先，其次边 id 字典序（保证降级结果可复现）。 */
function compareCandidateEdges(a: HierarchyEdgeLike, b: HierarchyEdgeLike): number {
  const am = a.weight === 'main' ? 0 : 1
  const bm = b.weight === 'main' ? 0 : 1
  if (am !== bm) return am - bm
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 从零构建一棵合规树。已存在的违规边不会被删除，而是记录进 downgrades
 * （由 normalizeTree 降级为 related）。
 */
export function buildHierarchy(
  nodeIds: readonly string[],
  edges: readonly HierarchyEdgeLike[],
): HierarchyBuildResult {
  const h = createHierarchy(nodeIds, edges)
  const candidates = edges.filter((edge) => isSubordinate(edge.relation)).slice()
  candidates.sort(compareCandidateEdges)

  const downgrades: TreeDowngrade[] = []
  for (const edge of candidates) {
    const result = validateSubordinateEdge(h, edge)
    if (!result.ok) {
      downgrades.push({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        reason: result.reason ?? 'cycle',
      })
      continue
    }
    attach(h, edge)
  }
  refreshRootsAndFree(h)
  return { hierarchy: h, downgrades }
}

/**
 * 整理成合规树：违规从属边降级为 `related`（**不删除**），其余边逐字段原样保留。
 * 断言由迁移脚本负责：节点数 / 边数 / 边 id / 两端 / 样式字段迁移前后完全相等。
 */
export function normalizeTree<T extends HierarchyEdgeLike>(
  nodeIds: readonly string[],
  edges: readonly T[],
): NormalizeTreeResult<T> {
  const projected = edges.map((edge) => toHierarchyEdge(edge))
  const { hierarchy, downgrades } = buildHierarchy(nodeIds, projected)
  const downgradeIds = new Map(downgrades.map((item) => [item.edgeId, item.reason]))
  const nextEdges = edges.map((edge) => (
    downgradeIds.has(edge.id)
      ? { ...edge, relation: DEFAULT_EDGE_RELATION_ID }
      : edge
  ))
  return { edges: nextEdges, downgrades, hierarchy }
}

export interface EdgeRelationChange {
  edgeId: string
  from: string
  to: EdgeRelation
}

export interface EdgeMigrationPlan<T extends HierarchyEdgeLike> {
  /** 只改 relation 字段，其余字段逐字段原样 */
  edges: T[]
  changes: EdgeRelationChange[]
  downgrades: TreeDowngrade[]
  hierarchy: GraphHierarchy
}

/**
 * 磁盘迁移的**唯一计划函数**：`migrate-edge-relations.mts` 与回归脚本共用，
 * 杜绝脚本里抄第二份映射表 / 第二套降级规则。
 * 顺序：先把所有旧值映射成两值，再把违规从属边降级为 related（不删边）。
 */
export function planEdgeRelationMigration<T extends HierarchyEdgeLike>(
  nodeIds: readonly string[],
  edges: readonly T[],
): EdgeMigrationPlan<T> {
  const changes: EdgeRelationChange[] = []
  const rewritten = edges.map((edge) => {
    const from = String(edge.relation ?? '<missing>')
    const to = readEdgeRelationId(edge.relation)
    changes.push({ edgeId: edge.id, from, to })
    return { ...edge, relation: to }
  })
  const tree = normalizeTree(nodeIds, rewritten)
  return {
    edges: tree.edges,
    changes,
    downgrades: tree.downgrades,
    hierarchy: tree.hierarchy,
  }
}

/**
 * LOD 可见性（由 `domain/graph/lod.ts` 的 computeLodVisibility 调用）：
 *   - 树根永远保留；游离节点最先隐藏；
 *   - pinned 节点始终显示且不参与树、不改 depth（用户决策：手动指定深度改为 pin）。
 * free 用 Set 判定，避免万级节点下 `Array.includes` 退化成 O(n²)。
 */
export function computeLodVisibleNodes(
  h: GraphHierarchy,
  maxDepth: number,
  pinned: ReadonlySet<string> = new Set(),
): Set<string> {
  const visible = new Set<string>(h.roots)
  const freeSet = new Set(h.free)
  for (const id of h.nodes) {
    if (pinned.has(id)) { visible.add(id); continue }
    if (freeSet.has(id)) continue
    if ((h.depth.get(id) ?? 1) <= maxDepth) visible.add(id)
  }
  return visible
}

export function describeDowngradeReason(reason: TreeDowngradeReason): string {
  switch (reason) {
    case 'self-loop': return '不能把节点连到自己'
    case 'multiple-parents': return '子节点已从属于其它节点（唯一父约束）'
    case 'cycle': return '这条从属边会构成环'
    case 'depth-limit': return `层级深度不能超过 ${MAX_HIERARCHY_DEPTH}`
    default: return '从属关系校验未通过'
  }
}

export { SUBORDINATE_EDGE_RELATION_ID, DEFAULT_EDGE_RELATION_ID }
