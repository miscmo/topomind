/**
 * 语义缩放的**视图偏好**：LOD 模式 + 永久显示层数 + 按房间隔离的置顶节点。
 *
 * 为什么不放进 `_graph.json`：
 *   - `pin` 是「始终显示」的视图标记，不参与树、不改 depth，不是知识内容；
 *   - 落盘到节点字段要同步 7 处白名单（历史高频 bug 来源），收益却只是跨设备同步
 *     一个显示开关。这里沿用顶部工具栏折叠偏好的做法，localStorage 持久化即可。
 *   - LOD 的权威数据仍是 edges 上的 relation，偏好丢了最多是置顶失效，可随时重设。
 */
import { useSyncExternalStore } from 'react'
import {
  LOD_DEFAULT_PRESERVED_DEPTH,
  normalizePreservedDepth,
  type LodMode,
} from '../../../../domain/graph/lod'

const STORAGE_KEY = 'topomind_semantic_lod_preferences_v1'

export interface LodPreferences {
  mode: LodMode
  /** 永久显示到哪一层的树深度（全局偏好，左侧状态面板随时可改） */
  preservedDepth: number
  /** roomPath → 置顶节点 id 列表 */
  pinnedByRoom: Record<string, string[]>
}

function emptyPreferences(): LodPreferences {
  return { mode: 'auto', preservedDepth: LOD_DEFAULT_PRESERVED_DEPTH, pinnedByRoom: {} }
}

function normalize(raw: unknown): LodPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyPreferences()
  const value = raw as Record<string, unknown>
  const mode: LodMode = value.mode === 'off' || value.mode === 'force' ? value.mode : 'auto'
  const pinnedByRoom: Record<string, string[]> = {}
  const rooms = value.pinnedByRoom
  if (rooms && typeof rooms === 'object' && !Array.isArray(rooms)) {
    for (const [room, ids] of Object.entries(rooms as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue
      const clean = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      if (clean.length > 0) pinnedByRoom[room] = clean
    }
  }
  return { mode, preservedDepth: normalizePreservedDepth(value.preservedDepth), pinnedByRoom }
}

function readStorage(): LodPreferences {
  if (typeof localStorage === 'undefined') return emptyPreferences()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw)) : emptyPreferences()
  } catch {
    return emptyPreferences()
  }
}

let snapshot: LodPreferences = readStorage()
const listeners = new Set<() => void>()

function commit(next: LodPreferences): void {
  snapshot = next
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch { /* 隐私模式 / 配额满：内存态仍然可用 */ }
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    snapshot = readStorage()
    for (const listener of listeners) listener()
  })
}

export function getLodPreferences(): LodPreferences {
  return snapshot
}

export function useLodPreferences(): LodPreferences {
  return useSyncExternalStore(subscribe, getLodPreferences, getLodPreferences)
}

export function setLodMode(mode: LodMode): void {
  if (snapshot.mode === mode) return
  commit({ ...snapshot, mode })
}

/**
 * 左侧状态面板随时变更「永久显示层数」。commit 先写快照再通知，
 * useSyncExternalStore 的订阅者会立刻读到新值并重算可见性计划（无需刷新 / 换房间）。
 */
export function setLodPreservedDepth(depth: number): void {
  const next = normalizePreservedDepth(depth)
  if (snapshot.preservedDepth === next) return
  commit({ ...snapshot, preservedDepth: next })
}

export function togglePinned(roomPath: string, nodeId: string): void {
  if (!roomPath || !nodeId) return
  const current = snapshot.pinnedByRoom[roomPath] ?? []
  const nextIds = current.includes(nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId]
  const nextRooms = { ...snapshot.pinnedByRoom }
  if (nextIds.length > 0) nextRooms[roomPath] = nextIds
  else delete nextRooms[roomPath]
  commit({ ...snapshot, pinnedByRoom: nextRooms })
}

export function clearPinned(roomPath: string): void {
  if (!roomPath || !(roomPath in snapshot.pinnedByRoom)) return
  const nextRooms = { ...snapshot.pinnedByRoom }
  delete nextRooms[roomPath]
  commit({ ...snapshot, pinnedByRoom: nextRooms })
}

/** 删除已不存在的节点 id，避免房间反复编辑后偏好无限膨胀。只在集合真变时写盘。 */
export function prunePinned(roomPath: string, validIds: ReadonlySet<string>): void {
  if (!roomPath) return
  const current = snapshot.pinnedByRoom[roomPath]
  if (!current) return
  const nextIds = current.filter((id) => validIds.has(id))
  if (nextIds.length === current.length) return
  const nextRooms = { ...snapshot.pinnedByRoom }
  if (nextIds.length > 0) nextRooms[roomPath] = nextIds
  else delete nextRooms[roomPath]
  commit({ ...snapshot, pinnedByRoom: nextRooms })
}

export function getPinnedIds(roomPath: string): string[] {
  return snapshot.pinnedByRoom[roomPath] ?? []
}
