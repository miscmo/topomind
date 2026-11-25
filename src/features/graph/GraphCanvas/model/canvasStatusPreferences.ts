/**
 * 画布状态抽屉的**视图偏好**：整体展开 / 折叠 + 每个功能区独立展开 / 折叠。
 *
 * 【2026-11-24】房间路径已回到标题栏的可点击面包屑、层级诊断已收敛成一行，
 * 抽屉只保留「视图」与「最近打开」两个可折叠区。旧快照里多余的 path / details
 * 键在 normalize 时自然忽略，不需要版本迁移。
 *
 * 纯视图态：不落图数据、不进 7 处字段白名单，和 lodPreferences 一样只用
 * localStorage 持久化；commit 先写快照再通知，避免 useSyncExternalStore 读到旧值。
 * 旧版「最近打开」有自己的折叠键，首次读取时迁移一次，用户设置不丢。
 */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'topomind_canvas_status_v1'
const LEGACY_RECENT_KEY = 'topomind_room_history_collapsed'

export type StatusSectionId = 'view' | 'recent'

export interface CanvasStatusPreferences {
  drawerOpen: boolean
  sections: Record<StatusSectionId, boolean>
}

/** 默认只展开「视图」：路径常驻标题、深度常驻底部，历史按需展开。 */
function defaults(): CanvasStatusPreferences {
  return {
    drawerOpen: true,
    sections: { view: true, recent: false },
  }
}

function normalize(raw: unknown): CanvasStatusPreferences {
  const base = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const value = raw as Record<string, unknown>
  if (typeof value.drawerOpen === 'boolean') base.drawerOpen = value.drawerOpen
  const sections = value.sections
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    for (const id of ['view', 'recent'] as StatusSectionId[]) {
      const open = (sections as Record<string, unknown>)[id]
      if (typeof open === 'boolean') base.sections[id] = open
    }
  }
  return base
}

function readStorage(): CanvasStatusPreferences {
  if (typeof localStorage === 'undefined') return defaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalize(JSON.parse(raw))
    const legacy = localStorage.getItem(LEGACY_RECENT_KEY)
    if (legacy !== null) {
      const base = defaults()
      base.sections.recent = legacy !== 'true'
      return base
    }
    return defaults()
  } catch {
    return defaults()
  }
}

let snapshot: CanvasStatusPreferences = readStorage()
const listeners = new Set<() => void>()

function commit(next: CanvasStatusPreferences): void {
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
    if (event.key !== STORAGE_KEY && event.key !== LEGACY_RECENT_KEY) return
    snapshot = readStorage()
    for (const listener of listeners) listener()
  })
}

export function getCanvasStatusPreferences(): CanvasStatusPreferences {
  return snapshot
}

export function useCanvasStatusPreferences(): CanvasStatusPreferences {
  return useSyncExternalStore(subscribe, getCanvasStatusPreferences, getCanvasStatusPreferences)
}

export function setCanvasStatusDrawerOpen(open: boolean): void {
  if (snapshot.drawerOpen === open) return
  commit({ ...snapshot, drawerOpen: open })
}

export function setCanvasStatusSectionOpen(id: StatusSectionId, open: boolean): void {
  if (snapshot.sections[id] === open) return
  commit({ ...snapshot, sections: { ...snapshot.sections, [id]: open } })
}

export function toggleCanvasStatusSection(id: StatusSectionId): void {
  setCanvasStatusSectionOpen(id, !snapshot.sections[id])
}
