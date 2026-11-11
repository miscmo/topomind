/**
 * 知识库总览（P3-B）唯一纯函数层。
 *
 * 设计边界（勿越界）：
 *   - 只读：只依赖 readLayout / readRoomNodeSummaries 两个现有只读入口，绝不写盘；
 *   - 懒加载：这里只统计房间摘要，不构建房间内节点/边、不读文档正文；
 *     真正进入房间仍走 enterRoomInTab → loadRoomGraph；
 *   - 房间是存储边界：总览不合并、不改写、不删除任何房间；
 *   - 层级连线只表达「父房间包含子房间」，不是用户说的「聚合边」（本刀刻意不做）。
 */
import { basenameRef, normalizeRef, resolveRoomChildRef } from './path-utils'

/** 单次总览最多读取的房间数，避免大知识库一次打爆 IPC 与画布。 */
export const MAX_OVERVIEW_ROOMS = 300
/** 最多展开的房间层级，防止异常嵌套或自引用把遍历拖死。 */
export const MAX_OVERVIEW_DEPTH = 8

export const OVERVIEW_CARD_WIDTH = 208
export const OVERVIEW_CARD_HEIGHT = 92
export const OVERVIEW_COLUMNS = 5
export const OVERVIEW_COLUMN_GAP = 36
export const OVERVIEW_ROW_GAP = 56

/** readLayout 归一化后的节点形状（KBNode）。宽松取值只为兼容历史档。 */
export interface RoomOverviewNodeLike {
  id?: string
  name?: string
  card?: { ref?: string; name?: string } | null
  cardRef?: string
}

export interface RoomOverviewMetaLike {
  nodes?: Record<string, RoomOverviewNodeLike> | null
  edges?: readonly unknown[] | null
}

export interface RoomSummaryLike {
  childCount?: number
  hasDetail?: boolean
}

/** 依赖注入：回归用假 storage 真跑，天然保证「只读」——这里没有写方法可调。 */
export interface RoomOverviewStorage {
  readLayout: (roomPath: string) => Promise<RoomOverviewMetaLike | null>
  readRoomNodeSummaries: (roomPaths: string[]) => Promise<Record<string, RoomSummaryLike | undefined>>
}

export interface RoomOverviewItem {
  path: string
  name: string
  depth: number
  parentPath: string | null
  nodeCount: number
  edgeCount: number
  childRoomCount: number
  status: 'ready' | 'unavailable'
}

export interface RoomOverviewResult {
  items: RoomOverviewItem[]
  truncated: boolean
  /** readLayout 实际调用次数（含失败），用于回归断言「每个房间只读一次」。 */
  readCount: number
}

/**
 * 房间路径必须是 kbs 根下的相对路径。
 * normalizeRef 会统一分隔符并去掉首尾斜杠，这里再挡住 ../、绝对路径与盘符。
 */
export function isSafeRoomPath(path: string): boolean {
  const normalized = normalizeRef(path)
  if (!normalized) return false
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized.endsWith('/..')) return false
  if (normalized.includes('\0')) return false
  if (/^[a-zA-Z]:/.test(normalized)) return false
  return true
}

interface QueueItem {
  path: string
  name: string
  depth: number
  parentPath: string | null
}

/**
 * 自顶向下 BFS 收集房间摘要。
 *
 * 关键取舍：不把「每个节点」都当房间展开。P0 轻量节点没有物化目录，
 * 若逐节点 readLayout 会退化成「1 次主图 + 2N 次小文件读」（file-service 注释里的老坑）。
 * 因此先用一次批量 readRoomNodeSummaries 过滤，只展开确实有内容（子节点或文档）的子房间；
 * 主进程内 existsSync 会快速跳过不存在的目录。
 */
export async function collectRoomOverviews(
  storage: RoomOverviewStorage,
  root: { path: string; name: string },
  options: { maxRooms?: number; maxDepth?: number } = {},
): Promise<RoomOverviewResult> {
  const maxRooms = Math.max(1, Math.min(options.maxRooms ?? MAX_OVERVIEW_ROOMS, MAX_OVERVIEW_ROOMS))
  const maxDepth = Math.max(0, Math.min(options.maxDepth ?? MAX_OVERVIEW_DEPTH, MAX_OVERVIEW_DEPTH))
  const rootPath = normalizeRef(root.path)
  if (!isSafeRoomPath(rootPath)) return { items: [], truncated: false, readCount: 0 }

  const queue: QueueItem[] = [{
    path: rootPath,
    name: root.name || basenameRef(rootPath),
    depth: 0,
    parentPath: null,
  }]
  const seen = new Set<string>()
  const items: RoomOverviewItem[] = []
  let readCount = 0
  let truncated = false

  while (queue.length > 0) {
    if (items.length >= maxRooms) {
      truncated = true
      break
    }
    const current = queue.shift() as QueueItem
    if (seen.has(current.path)) continue
    seen.add(current.path)

    let meta: RoomOverviewMetaLike | null = null
    try {
      meta = await storage.readLayout(current.path)
      readCount += 1
    } catch {
      readCount += 1
    }
    if (!meta) {
      items.push({
        ...current,
        nodeCount: 0,
        edgeCount: 0,
        childRoomCount: 0,
        status: 'unavailable',
      })
      continue
    }

    const entries = Object.entries(meta.nodes ?? {})
    const children = entries
      .map(([nodeId, node]) => {
        const ref = normalizeRef(node?.card?.ref ?? node?.cardRef ?? node?.id ?? nodeId)
        return {
          path: resolveRoomChildRef(current.path, ref),
          name: String(node?.card?.name ?? node?.name ?? nodeId),
        }
      })
      .filter((child) => isSafeRoomPath(child.path))

    const childPaths = children.map((child) => child.path)
    let summaries: Record<string, RoomSummaryLike | undefined> = {}
    if (childPaths.length > 0) {
      try {
        summaries = (await storage.readRoomNodeSummaries(childPaths)) ?? {}
      } catch {
        summaries = {}
      }
    }
    const activeChildren = children.filter((child) => {
      const summary = summaries[child.path]
      return (summary?.childCount ?? 0) > 0 || summary?.hasDetail === true
    })

    items.push({
      ...current,
      nodeCount: entries.length,
      edgeCount: (meta.edges ?? []).length,
      childRoomCount: activeChildren.length,
      status: 'ready',
    })

    if (current.depth >= maxDepth) continue
    for (const child of activeChildren) {
      // 去重只在出队处做一次：多个父房间引用同一路径（或自引用）时，
      // 入队允许重复，出队处统一跳过，避免「两处都挡」造成断言盲区。
      queue.push({
        path: child.path,
        name: child.name || basenameRef(child.path),
        depth: current.depth + 1,
        parentPath: current.path,
      })
    }
  }

  return { items, truncated, readCount }
}

export interface RoomOverviewCard {
  id: string
  item: RoomOverviewItem
  position: { x: number; y: number }
}

export interface RoomOverviewLink {
  id: string
  source: string
  target: string
}

/** 按深度分层做稳定网格布局；同层按 path 排序，保证刷新后位置不跳。 */
export function layoutRoomOverview(
  items: readonly RoomOverviewItem[],
): { cards: RoomOverviewCard[]; links: RoomOverviewLink[] } {
  const sorted = [...items].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
  const depths = [...new Set(sorted.map((item) => item.depth))].sort((a, b) => a - b)
  const cards: RoomOverviewCard[] = []
  let rowOffset = 0

  for (const depth of depths) {
    const group = sorted.filter((item) => item.depth === depth)
    group.forEach((item, index) => {
      cards.push({
        id: item.path,
        item,
        position: {
          x: (index % OVERVIEW_COLUMNS) * (OVERVIEW_CARD_WIDTH + OVERVIEW_COLUMN_GAP),
          y: (rowOffset + Math.floor(index / OVERVIEW_COLUMNS)) * (OVERVIEW_CARD_HEIGHT + OVERVIEW_ROW_GAP),
        },
      })
    })
    rowOffset += Math.ceil(group.length / OVERVIEW_COLUMNS) + 1
  }

  const known = new Set(cards.map((card) => card.id))
  const links: RoomOverviewLink[] = sorted
    .filter((item) => item.parentPath && known.has(item.parentPath))
    .map((item) => ({
      id: `room-link:${item.parentPath as string}->${item.path}`,
      source: item.parentPath as string,
      target: item.path,
    }))

  return { cards, links }
}
