/**
 * 左侧节点树：唯一规则源（纯函数，无 DOM / 无 store / 无 IPC，供 esbuild 真跑）。
 *
 * 【结构契约 2026-11-13】
 *  - 顶层是「当前房间」虚拟根（origin='room-root'），显示房间名，不对应画布节点；
 *  - 房间内从属树复用 graphHierarchy.buildHierarchy 的强校验结果（唯一父 / 无环 / ≤100）；
 *  - 可进入的节点 A 展开后，A 房间的从属树根直接作为 A 的子节点（origin='room-child'），
 *    与 A 的普通从属子节点同级，默认排第一；AA 的子节点继续挂在 AA 下；
 *  - 游离节点（无从属父、无从属子）恒挂在其所属房间代表节点末尾（origin='free'），
 *    带「游离」标记且不可拖动排序；
 *  - treeOrder 是**每个节点**上的可选数值，只影响本列表的同级排列，绝不改画布坐标。
 *
 * 【存量兼容】没有 treeOrder 的节点：房间子节点默认第一（-1e6），普通节点按遍历顺序
 * 追加到尾部（1e6 + 遍历序号）；显式写过 treeOrder 的节点按值升序，永远排在「未排序」
 * 的新节点之前 —— 于是「新节点追加尾部」不需要在创建时写任何字段。
 */
import {
  buildHierarchy,
  MAX_HIERARCHY_DEPTH,
  type HierarchyEdgeLike,
} from './graphHierarchy.ts'
import { normalizeTreeOrder } from './treeOrder.ts'

export { normalizeTreeOrder } from './treeOrder.ts'

export const NODE_TREE_MAX_DEPTH = MAX_HIERARCHY_DEPTH

/** tree key 的唯一编码源：面板持久化、展开集合、拖动都用它，禁止在别处拼字符串。 */
export function makeNodeTreeKey(roomPath: string, id: string): string {
  return `${roomPath}:${id}`
}
export function makeRoomRootKey(roomPath: string): string {
  return `room-root:${roomPath}`
}

/** 默认只展开房间虚拟根（能看到第一层），其余节点全部折叠。 */
export function defaultExpandedKeys(rootKey: string): Set<string> {
  return new Set([rootKey])
}

export function toggleExpandedKeys(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** 「加载子房间」时只保证展开，不能把已展开的节点又折叠回去。 */
export function ensureExpandedKeys(keys: ReadonlySet<string>, key: string): Set<string> {
  if (keys.has(key)) return new Set(keys)
  const next = new Set(keys)
  next.add(key)
  return next
}

/** 「展开全部」用：必须传完整树（fullTree），懒加载树里没有折叠分支。 */
export function collectNodeTreeKeys(root: NodeTreeNode): string[] {
  const keys: string[] = [root.key]
  const walk = (node: NodeTreeNode): void => {
    for (const child of node.children) {
      keys.push(child.key)
      walk(child)
    }
  }
  walk(root)
  return keys
}

export type NodeTreeOrigin = 'room-root' | 'subordinate' | 'room-child' | 'free'

export interface NodeTreeSourceNode {
  id: string
  label: string
  /** 同级顺序；缺省 = 按遍历顺序追加尾部 */
  treeOrder?: number
  /** 子房间节点数；>0 表示这个节点可以进入（来自 node.data.childCount） */
  childCount?: number
}

/** 一个房间的轻量快照：只读一次 _graph.json 就能构建，不读文档正文。 */
export interface NodeTreeRoom {
  roomPath: string
  roomName: string
  nodes: NodeTreeSourceNode[]
  /** 只保留从属边（related 不进树） */
  subordinateEdges: Array<{ id?: string; source: string; target: string; weight?: string }>
}

export interface NodeTreeNode {
  /** 全局唯一（房间路径 + 节点 id），子房间里的同名节点不会串键 */
  key: string
  id: string
  roomPath: string
  label: string
  origin: NodeTreeOrigin
  depth: number
  treeOrder?: number
  /** 该节点可否进入子房间 */
  hasChildRoom: boolean
  /** 子房间快照是否已加载（未加载时只显示展开箭头） */
  roomLoaded: boolean
  childRoomPath: string
  /** 可否拖动排序：只有当前房间里的从属节点可以（跨房间写入另需房间级保存） */
  sortable: boolean
  /**
   * 是否「有可展开的下一层」（从属子节点或可进入的子房间）。
   * 懒加载下 children 可能为空，箭头显示只能依赖这个字段，不能依赖 children.length。
   */
  hasChildren: boolean
  children: NodeTreeNode[]
}

export interface BuildNodeTreeInput {
  root: NodeTreeRoom
  /** roomPath -> 已加载的子房间快照；未出现即「折叠、按需加载」 */
  rooms?: Record<string, NodeTreeRoom | null | undefined>
  /** 纯函数式房间路径拼接，默认用 POSIX 风格 join */
  resolveChildRoomPath?: (roomPath: string, nodeId: string) => string
  /**
   * 懒加载开关：给定展开集合时，只构造「已展开节点」的直接子节点，
   * 折叠分支一行子树都不建；不传则构建完整树（搜索 / 计数 / 回归用）。
   */
  expandedKeys?: ReadonlySet<string>
}

function defaultResolve(roomPath: string, nodeId: string): string {
  return roomPath ? `${roomPath}/${nodeId}` : nodeId
}

/**
 * 同级排序：free 恒末尾；room-child 默认第一；显式 treeOrder 升序；
 * 其余按遍历顺序追加尾部。稳定排序用遍历序号兜底。
 */
export function orderSiblings<T extends { origin: NodeTreeOrigin; treeOrder?: number }>(
  items: ReadonlyArray<{ node: T; index: number }>,
): T[] {
  const decorated = items.map(({ node, index }) => ({
    node,
    index,
    key: node.origin === 'free'
      ? Number.POSITIVE_INFINITY
      : node.treeOrder ?? (node.origin === 'room-child' ? -1_000_000 + index : 1_000_000 + index),
  }))
  decorated.sort((a, b) => (a.key - b.key) || (a.index - b.index))
  return decorated.map((item) => item.node)
}

/**
 * 拖动排序的唯一计划函数：只重排「可排序」兄弟节点，返回整组新的 treeOrder。
 * room-child / free 不参与也不写字段，因此「房间子节点默认第一、游离恒末尾」永远成立。
 * 返回 null = 无效拖动（拖的不是可排序节点、同位置、或跨父）。
 */
export interface TreeOrderUpdate {
  id: string
  treeOrder: number
}

export function reorderSiblings(
  siblings: readonly NodeTreeNode[],
  fromKey: string,
  toKey: string,
): TreeOrderUpdate[] | null {
  const sortable = siblings.filter((node) => node.sortable)
  const from = sortable.findIndex((node) => node.key === fromKey)
  const to = sortable.findIndex((node) => node.key === toKey)
  if (from < 0 || to < 0 || from === to) return null
  const next = sortable.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((node, index) => ({ id: node.id, treeOrder: index }))
}

export interface NodeTreeSearchHit {
  key: string
  id: string
  roomPath: string
  label: string
  origin: NodeTreeOrigin
  /** 从房间虚拟根到该节点的显示名链路（不含自身重复） */
  path: string[]
}

/** 搜索：`if (!q) return []` 是硬约束，不在空查询时遍历整棵树。 */
export function flattenTreeForSearch(root: NodeTreeNode, query: string): NodeTreeSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: NodeTreeSearchHit[] = []
  const walk = (node: NodeTreeNode, path: string[]): void => {
    const nextPath = node.origin === 'room-root' ? path : [...path, node.label]
    if (node.origin !== 'room-root' && node.label.toLowerCase().includes(q)) {
      hits.push({
        key: node.key,
        id: node.id,
        roomPath: node.roomPath,
        label: node.label,
        origin: node.origin,
        path,
      })
    }
    if (hits.length >= 200) return
    for (const child of node.children) walk(child, nextPath)
  }
  walk(root, [])
  return hits
}

/** 把磁盘/内存里的房间 meta 投影成树用的轻量快照。 */
export function toNodeTreeRoom(input: {
  roomPath: string
  roomName: string
  nodes: ReadonlyArray<{ id: string; label?: string; treeOrder?: unknown; childCount?: unknown }>
  edges: ReadonlyArray<{ id?: string; source: string; target: string; relation: unknown; weight?: string }>
}): NodeTreeRoom {
  return {
    roomPath: input.roomPath,
    roomName: input.roomName,
    nodes: input.nodes.map((node) => ({
      id: node.id,
      label: typeof node.label === 'string' && node.label.trim() ? node.label : node.id,
      treeOrder: normalizeTreeOrder(node.treeOrder),
      childCount: typeof node.childCount === 'number' && Number.isFinite(node.childCount)
        ? Math.max(0, node.childCount)
        : 0,
    })),
    subordinateEdges: input.edges
      .filter((edge) => edge.relation === 'subordinate')
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
      })),
  }
}

/**
 * 构建整棵树。子房间全部折叠（rooms 里没有就只有展开箭头），
 * 只有已加载的房间快照才会长出 room-child / free 子节点。
 */
export function buildNodeTree(input: BuildNodeTreeInput): NodeTreeNode {
  const { root, rooms = {}, resolveChildRoomPath = defaultResolve, expandedKeys } = input

  const buildLevel = (
    room: NodeTreeRoom,
    originForRoots: NodeTreeOrigin,
    depth: number,
    visitedRooms: ReadonlySet<string>,
  ): NodeTreeNode[] => {
    if (depth > NODE_TREE_MAX_DEPTH) return []
    const nodeIds = room.nodes.map((node) => node.id)
    const edges: HierarchyEdgeLike[] = room.subordinateEdges.map((edge, index) => ({
      id: edge.id ?? `tree-sub-${index}`,
      source: edge.source,
      target: edge.target,
      relation: 'subordinate',
      weight: edge.weight,
    }))
    const { hierarchy } = buildHierarchy(nodeIds, edges)
    const byId = new Map(room.nodes.map((node) => [node.id, node]))
    const naturalIndex = new Map(room.nodes.map((node, index) => [node.id, index]))

    const makeNode = (id: string, origin: NodeTreeOrigin, children: NodeTreeNode[], level: number): NodeTreeNode => {
      const source = byId.get(id)
      const childRoomPath = source && source.childCount && source.childCount > 0
        ? resolveChildRoomPath(room.roomPath, id)
        : ''
      const loaded = !!childRoomPath && !!rooms[childRoomPath]
      return {
        key: makeNodeTreeKey(room.roomPath, id),
        id,
        roomPath: room.roomPath,
        label: source?.label ?? id,
        origin,
        // 必须用递归的 level，不能用本层的起始 depth，否则整棵树深度会塌成 1。
        depth: level,
        treeOrder: source ? normalizeTreeOrder(source.treeOrder) : undefined,
        hasChildRoom: !!childRoomPath,
        roomLoaded: loaded,
        childRoomPath,
        sortable: origin === 'subordinate' && room.roomPath === root.roomPath,
        // 折叠时 children 为空，箭头仍要可见，故由层级 + 房间标记独立推导。
        hasChildren: (hierarchy.children.get(id)?.length ?? 0) > 0 || !!childRoomPath,
        children,
      }
    }

    // 从属子节点 + 已加载的子房间根节点，两者共用同一套排序规则。
    // 注意游离节点**也可能同时是可进入房间**（无边但有子房间目录），
    // 所以不能只对从属树根调用 walk；childrenOf 必须对 roots 与 free 都生效。
    const childrenOf = (id: string, level: number): NodeTreeNode[] => {
      // 【懒加载铁律】折叠节点一行子树都不构造（更不会读子房间 meta）。
      // 展开时才递归构建它的直接子节点，更深一层继续由各自节点的展开态决定。
      if (expandedKeys && !expandedKeys.has(makeNodeTreeKey(room.roomPath, id))) return []
      const items: Array<{ node: NodeTreeNode; index: number }> = []
      for (const childId of hierarchy.children.get(id) ?? []) {
        if (level >= NODE_TREE_MAX_DEPTH) break
        items.push({
          node: walk(childId, 'subordinate', level + 1),
          index: naturalIndex.get(childId) ?? 0,
        })
      }
      const source = byId.get(id)
      const childRoomPath = source && source.childCount && source.childCount > 0
        ? resolveChildRoomPath(room.roomPath, id)
        : ''
      const childRoom = childRoomPath ? rooms[childRoomPath] : null
      if (childRoom && !visitedRooms.has(childRoomPath) && level < NODE_TREE_MAX_DEPTH) {
        const nextVisited = new Set(visitedRooms)
        nextVisited.add(childRoomPath)
        const inner = buildLevel(childRoom, 'room-child', level + 1, nextVisited)
        inner.forEach((node, index) => items.push({ node, index: 100_000 + index }))
      }
      return orderSiblings(items)
    }

    function walk(id: string, origin: NodeTreeOrigin, level: number): NodeTreeNode {
      return makeNode(id, origin, childrenOf(id, level), level)
    }

    const topItems: Array<{ node: NodeTreeNode; index: number }> = []
    for (const rootId of hierarchy.roots) {
      topItems.push({
        node: walk(rootId, originForRoots, depth),
        index: naturalIndex.get(rootId) ?? 0,
      })
    }
    // 游离节点恒挂在本房间代表节点末尾；room-child 房间里的 free 同理挂在 A 下。
    for (const freeId of hierarchy.free) {
      topItems.push({
        node: makeNode(freeId, 'free', childrenOf(freeId, depth), depth),
        index: 200_000 + (naturalIndex.get(freeId) ?? 0),
      })
    }
    return orderSiblings(topItems)
  }

  const rootKey = makeRoomRootKey(root.roomPath)
  const rootOpen = !expandedKeys || expandedKeys.has(rootKey)
  return {
    key: rootKey,
    id: root.roomPath || '__ROOT__',
    roomPath: root.roomPath,
    label: root.roomName,
    origin: 'room-root',
    depth: 0,
    hasChildRoom: false,
    roomLoaded: true,
    childRoomPath: '',
    sortable: false,
    hasChildren: root.nodes.length > 0,
    children: rootOpen
      ? buildLevel(root, 'subordinate', 1, new Set([root.roomPath]))
      : [],
  }
}
