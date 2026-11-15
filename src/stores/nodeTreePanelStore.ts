/**
 * 左侧节点树面板偏好（localStorage 持久化，全局一份）。
 *
 *  - collapsed：面板本体折叠态；
 *  - expandedByRoom：按房间记忆「哪些节点被展开」，默认只展开房间虚拟根，
 *    其余节点全部折叠；空数组表示连房间根也收起。
 *
 * 画布 React 代码不订阅本 store：展开时只通过 CSS 变量让 top-left 状态抽屉
 * 横向让位，画布宽度 / viewport / 其它 Panel 一律不变。
 */
import { create } from 'zustand'
import {
  defaultExpandedKeys,
  ensureExpandedKeys,
  toggleExpandedKeys,
} from '../domain/graph/nodeTree'

export const NODE_TREE_PANEL_WIDTH = 280

const COLLAPSED_KEY = 'topomind_node_tree_panel_v1'
const EXPANDED_KEY = 'topomind_node_tree_expanded_v2'
const MAX_ROOMS = 24
const MAX_KEYS_PER_ROOM = 600

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // 隐私模式下不可写，保持本次会话状态即可
  }
}

function readExpandedByRoom(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string[]> = {}
    for (const [roomPath, keys] of Object.entries(parsed).slice(0, MAX_ROOMS)) {
      if (Array.isArray(keys)) {
        result[roomPath] = keys
          .filter((key): key is string => typeof key === 'string')
          .slice(0, MAX_KEYS_PER_ROOM)
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeExpandedByRoom(value: Record<string, string[]>): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(value))
  } catch {
    // 同上：写不进时至少本次会话有效
  }
}

interface NodeTreePanelState {
  collapsed: boolean
  /** roomPath -> 展开的 tree key 列表；缺省（无该房间记录）= 只展开房间根 */
  expandedByRoom: Record<string, string[]>
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
  toggleNode: (roomPath: string, rootKey: string, key: string) => void
  /** 加载子房间时只保证展开，不把已展开节点又折叠回去 */
  expandNode: (roomPath: string, rootKey: string, key: string) => void
  expandAll: (roomPath: string, rootKey: string, keys: readonly string[]) => void
  collapseAll: (roomPath: string, rootKey: string) => void
}

export const useNodeTreePanelStore = create<NodeTreePanelState>((set, get) => {
  const keysFor = (roomPath: string, rootKey: string): Set<string> => {
    const saved = get().expandedByRoom[roomPath]
    return saved ? new Set(saved) : defaultExpandedKeys(rootKey)
  }
  const commit = (roomPath: string, keys: ReadonlySet<string>): Record<string, string[]> => {
    const next = {
      ...get().expandedByRoom,
      [roomPath]: [...keys].slice(0, MAX_KEYS_PER_ROOM),
    }
    writeExpandedByRoom(next)
    return next
  }

  return {
    collapsed: readCollapsed(),
    expandedByRoom: readExpandedByRoom(),
    setCollapsed: (collapsed) => {
      writeCollapsed(collapsed)
      set({ collapsed })
    },
    toggle: () => set((state) => {
      const collapsed = !state.collapsed
      writeCollapsed(collapsed)
      return { collapsed }
    }),
    toggleNode: (roomPath, rootKey, key) => {
      const keys = toggleExpandedKeys(keysFor(roomPath, rootKey), key)
      set({ expandedByRoom: commit(roomPath, keys) })
    },
    expandNode: (roomPath, rootKey, key) => {
      const current = keysFor(roomPath, rootKey)
      if (current.has(key)) return
      const keys = ensureExpandedKeys(current, key)
      set({ expandedByRoom: commit(roomPath, keys) })
    },
    expandAll: (roomPath, rootKey, allKeys) => {
      const keys = new Set(keysFor(roomPath, rootKey))
      // 房间根恒展开，否则「展开全部」反而看不到第一层。
      keys.add(rootKey)
      for (const key of allKeys) keys.add(key)
      set({ expandedByRoom: commit(roomPath, keys) })
    },
    collapseAll: (roomPath, rootKey) => {
      set({ expandedByRoom: commit(roomPath, defaultExpandedKeys(rootKey)) })
    },
  }
})
