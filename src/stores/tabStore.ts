/**
 * Tab 多知识库管理（Zustand）
 *
 * 管理所有 KB Tab 的 UI 状态和房间导航状态，实现多标签页间的状态隔离。
 * 每个 Tab 独立维护自己的 roomHistory 栈、当前房间路径、搜索关键词和节点选中状态，
 * 切换 Tab 时通过 saveRoomStateToTab / restoreRoomStateToTab 与 roomStore 同步。
 *
 * Tab 类型分为两类：
 * - `home`：主页 Tab，仅有一个，不可关闭
 * - `kb`：知识库 Tab，每个 KB 一个，支持增删
 *
 * @see roomStore 房间导航状态（单例，当前激活 Tab 的房间状态）
 */
import { create } from 'zustand'
import type { RoomHistoryItem } from '../types'

/**
 * Tab 实例数据结构
 * @property id - Tab 唯一标识（home Tab 为 'home'，KB Tab 通常为 kbPath）
 * @property type - Tab 类型：'home'（主页，不可关闭）或 'kb'（知识库）
 * @property label - Tab 显示名称
 * @property kbPath - KB 根路径（仅 type='kb' 时有效）
 * @property isDirty - 是否存在未保存修改（影响 Tab 标题 · 标识）
 * @property roomHistory - 该 Tab 的房间导航历史栈
 * @property currentRoomPath - 该 Tab 当前所在房间路径
 * @property currentRoomName - 该 Tab 当前所在房间名称
 * @property searchQuery - 该 Tab 的搜索关键词（切换 Tab 时保持）
 * @property selectedNodeId - 该 Tab 选中的节点路径
 */
export interface Tab {
  id: string
  type: 'home' | 'kb'
  label: string
  kbPath?: string
  isDirty: boolean
  roomHistory?: RoomHistoryItem[]
  currentRoomPath?: string
  currentRoomName?: string
  searchQuery?: string
  selectedNodeId?: string | null
}

interface TabState {
  tabs: Tab[]
  activeTabId: string

  /** 初始化主页 Tab（仅在首次启动时调用一次） */
  initHomeTab: () => void
  /** 向 tabs 数组追加一个新 Tab */
  addTab: (tab: Tab) => void
  /** 新增一个 KB Tab，id 重复则忽略；同时初始化 roomHistory 为空、搜索为空、选中为空 */
  addKBTab: (tab: { id: string; label: string; kbPath: string; isDirty?: boolean }) => void
  /** 根据 tabId 移除 Tab（home Tab 不可移除）；若关闭的是当前活跃 Tab，自动切换到就近 Tab */
  removeTab: (tabId: string) => void
  /** 将指定 Tab 设为活跃 Tab（切换 UI 显示） */
  setActiveTab: (tabId: string) => void
  /** 更新指定 Tab 的脏标记（用于 Tab 标题的 · 标识） */
  setTabDirty: (tabId: string, isDirty: boolean) => void
  /** 获取当前活跃 Tab 对象 */
  getActiveTab: () => Tab | undefined
  /** 根据 id 查找 Tab */
  getTabById: (tabId: string) => Tab | undefined
  /** 将 roomStore 的房间状态快照保存到指定 Tab（Tab 切换时调用） */
  saveRoomStateToTab: (tabId: string, roomState: { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string }) => void
  /** 从快照恢复房间状态到指定 Tab（切换回 Tab 时调用） */
  restoreRoomStateToTab: (tabId: string, roomState: { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string; kbPath?: string | null }) => void
  /** 在指定 Tab 内进入房间：将当前房间压入 history 栈，再切换到目标房间；返回切换后的目标房间信息 */
  enterRoomInTab: (tabId: string, room: { path: string; kbPath: string; name: string }) => void
  /** 在指定 Tab 内执行 goBack：弹出 history 最后一项；若新 history 为空则退回 KB 全局视图；返回弹出项的房间信息 */
  goBackInTab: (tabId: string) => { path: string; kbPath: string; name: string } | null
  /** 在指定 Tab 内按索引跳转 history：保留 index 之前项，丢弃之后项；返回目标房间信息 */
  navigateToHistoryIndexInTab: (tabId: string, index: number) => { path: string; kbPath: string; name: string } | null
  /** 读取指定 Tab 的房间状态快照（用于 saveRoomStateToTab 的反向操作） */
  getRoomStateFromTab: (tabId: string) => { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string } | null
  /** 更新指定 Tab 的搜索关键词（Tab 切换时保持各自的搜索状态） */
  setTabSearchQuery: (tabId: string, query: string) => void
  /** 读取指定 Tab 的搜索关键词 */
  getTabSearchQuery: (tabId: string) => string
  /** 更新指定 Tab 的选中节点 ID */
  setTabSelectedNode: (tabId: string, nodeId: string | null) => void
  /** 读取指定 Tab 的选中节点 ID */
  getTabSelectedNode: (tabId: string) => string | null
}

export const tabStore = create<TabState>()((set, get) => ({
  tabs: [],
  activeTabId: 'home',

  /**
   * 初始化主页 Tab（仅在首次启动时调用一次）
   * 创建 id='home' 的 Tab，并将 activeTabId 指向它
   */
  initHomeTab: () => {
    set({
      tabs: [{ id: 'home', type: 'home', label: '首页', isDirty: false }],
      activeTabId: 'home',
    })
  },

  /**
   * 向 tabs 数组追加一个新 Tab
   * @param tab - 要添加的 Tab 对象（type='home' 或 'kb'）
   */
  addTab: (tab: Tab) => {
    set((state) => ({ tabs: [...state.tabs, tab] }))
  },

  /**
   * 新增一个 KB Tab
   * - id 重复时忽略（防重）
   * - 初始化 roomHistory 为空、searchQuery 为空、selectedNodeId 为 null
   * @param params.id - Tab 唯一标识（通常为 kbPath）
   * @param params.label - Tab 显示名称（KB 名）
   * @param params.kbPath - KB 根路径
   * @param params.isDirty - 是否脏标记（默认 false）
   */
  addKBTab: ({ id, label, kbPath, isDirty = false }) => {
    set((state) => {
      const exists = state.tabs.some((t) => t.id === id)
      if (exists) return state
      return {
        tabs: [
          ...state.tabs,
          {
            id,
            type: 'kb',
            label,
            kbPath,
            isDirty,
            roomHistory: [],
            currentRoomPath: kbPath,
            currentRoomName: label,
            searchQuery: '',
            selectedNodeId: null,
          },
        ],
      }
    })
  },

  /**
   * 根据 tabId 移除 Tab
   * - home Tab（id='home'）不可移除
   * - 若关闭的是当前活跃 Tab，自动切换到就近 Tab（优先取关闭位置的前一个，否则取首页）
   * @param tabId - 要关闭的 Tab id
   */
  removeTab: (tabId: string) => {
    if (tabId === 'home') return

    const { tabs, activeTabId } = get()
    const closedIdx = tabs.findIndex((t) => t.id === tabId)
    const newTabs = tabs.filter((t) => t.id !== tabId)

    let newActiveTabId = activeTabId
    if (activeTabId === tabId) {
      const fallbackIdx = Math.max(closedIdx - 1, 0)
      newActiveTabId = newTabs[fallbackIdx]?.id ?? 'home'
    }

    set({ tabs: newTabs, activeTabId: newActiveTabId })
  },

  /**
   * 将指定 Tab 设为活跃 Tab（切换 UI 显示）
   * @param tabId - 目标 Tab id
   */
  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },

  /**
   * 更新指定 Tab 的脏标记（用于 Tab 标题的 · 标识）
   * @param tabId - 目标 Tab id
   * @param isDirty - 是否存在未保存修改
   */
  setTabDirty: (tabId: string, isDirty: boolean) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty } : t
      ),
    }))
  },

  /**
   * 获取当前活跃 Tab 对象
   * @returns activeTabId 对应的 Tab，若未找到返回 undefined
   */
  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId)
  },

  /**
   * 根据 id 查找 Tab
   * @param tabId - Tab 唯一标识
   * @returns 对应 Tab，若不存在返回 undefined
   */
  getTabById: (tabId) => {
    return get().tabs.find((t) => t.id === tabId)
  },

  /**
   * 将 roomStore 的房间状态快照保存到指定 Tab（Tab 切换时调用）
   * 切换 Tab 前：读取 roomStore 状态，调用此方法将状态持久化到对应 Tab
   * @param tabId - 目标 Tab id
   * @param roomState - 房间快照（roomHistory + currentRoomPath + currentRoomName）
   */
  saveRoomStateToTab: (tabId, roomState) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              roomHistory: roomState.roomHistory,
              currentRoomPath: roomState.currentRoomPath ?? undefined,
              currentRoomName: roomState.currentRoomName,
            }
          : t
      ),
    }))
  },

  /**
   * 从快照恢复房间状态到指定 Tab（切换回 Tab 时调用）
   * 切换回 Tab 时：从 Tab 读取快照，调用此方法恢复 roomStore 状态
   * @param tabId - 目标 Tab id
   * @param roomState - 房间快照（包含可选 kbPath 用于更新 Tab 的 kbPath）
   */
  restoreRoomStateToTab: (tabId, roomState) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              kbPath: roomState.kbPath ?? t.kbPath,
              roomHistory: roomState.roomHistory,
              currentRoomPath: roomState.currentRoomPath ?? undefined,
              currentRoomName: roomState.currentRoomName,
            }
          : t
      ),
    }))
  },

  /**
   * 在指定 Tab 内进入房间
   * - 若已在某房间内：将当前房间压入 history 栈，再切换到目标房间
   * - 若当前在 KB 全局视图：直接切换，清空 history
   * @param tabId - 目标 Tab id
   * @param room - 目标房间（path/kbPath/name）
   */
  enterRoomInTab: (tabId, room) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== 'kb') return t

        const currentRoomPath = t.currentRoomPath ?? t.kbPath ?? null
        const currentRoomName = t.currentRoomName ?? t.label
        const baseKbPath = room.kbPath || t.kbPath || ''

        if (currentRoomPath) {
          return {
            ...t,
            kbPath: baseKbPath,
            roomHistory: [
              ...(t.roomHistory ?? []),
              { room: { path: currentRoomPath, kbPath: baseKbPath, name: currentRoomName } },
            ],
            currentRoomPath: room.path,
            currentRoomName: room.name,
          }
        }

        return {
          ...t,
          kbPath: baseKbPath,
          roomHistory: [],
          currentRoomPath: room.path,
          currentRoomName: room.name,
        }
      }),
    }))
  },

  /**
   * 在指定 Tab 内执行 goBack
   * - history 为空：不做任何操作，返回 null
   * - 新 history 为空：退回 KB 全局视图（currentRoomPath = kbPath）
   * - 新 history 有内容：current 设为倒数第二条历史
   * @param tabId - 目标 Tab id
   * @returns 被弹出的房间信息（path/kbPath/name），history 为空时返回 null
   */
  goBackInTab: (tabId) => {
    let target: { path: string; kbPath: string; name: string } | null = null

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== 'kb') return t

        const history = t.roomHistory ?? []
        if (history.length === 0) {
          return t
        }

        const lastItem = history[history.length - 1]
        const newHistory = history.slice(0, -1)
        const kbPath = t.kbPath || lastItem.room.kbPath || ''

        if (newHistory.length === 0) {
          target = { path: kbPath, kbPath, name: t.label }
          return {
            ...t,
            kbPath,
            roomHistory: [],
            currentRoomPath: kbPath,
            currentRoomName: t.label,
          }
        }

        const prev = newHistory[newHistory.length - 1]
        target = { path: prev.room.path, kbPath: prev.room.kbPath, name: prev.room.name }
        return {
          ...t,
          kbPath: prev.room.kbPath,
          roomHistory: newHistory,
          currentRoomPath: prev.room.path,
          currentRoomName: prev.room.name,
        }
      }),
    }))

    return target
  },

  /**
   * 在指定 Tab 内按索引跳转 history
   * - 保留 index 之前的所有历史项，丢弃之后项
   * - index 越界（<0 或 >=length）：忽略，不做任何操作
   * @param tabId - 目标 Tab id
   * @param index - 目标 history 索引
   * @returns 跳转后的目标房间信息，忽略时返回 null
   */
  navigateToHistoryIndexInTab: (tabId, index) => {
    let target: { path: string; kbPath: string; name: string } | null = null

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== 'kb') return t

        const history = t.roomHistory ?? []
        if (index < 0 || index >= history.length) return t

        const targetItem = history[index]
        const newHistory = history.slice(0, index)
        const kbPath = t.kbPath || targetItem.room.kbPath || ''

        target = {
          path: targetItem.room.path,
          kbPath: targetItem.room.kbPath || kbPath,
          name: targetItem.room.name,
        }
        return {
          ...t,
          kbPath,
          roomHistory: newHistory,
          currentRoomPath: targetItem.room.path,
          currentRoomName: targetItem.room.name,
        }
      }),
    }))

    return target
  },

  /**
   * 读取指定 Tab 的房间状态快照
   * 用于 Tab 切换时，将状态写回 roomStore
   * @param tabId - 目标 Tab id
   * @returns 房间快照（roomHistory + currentRoomPath + currentRoomName），Tab 不存在时返回 null
   */
  getRoomStateFromTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return null
    return {
      roomHistory: tab.roomHistory ?? [],
      currentRoomPath: tab.currentRoomPath ?? null,
      currentRoomName: tab.currentRoomName ?? '全局',
    }
  },

  /**
   * 更新指定 Tab 的搜索关键词（Tab 切换时保持各自的搜索状态）
   * @param tabId - 目标 Tab id
   * @param query - 搜索关键词
   */
  setTabSearchQuery: (tabId, query) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, searchQuery: query } : t
      ),
    }))
  },

  /**
   * 读取指定 Tab 的搜索关键词
   * @param tabId - 目标 Tab id
   * @returns 该 Tab 的搜索关键词，若无则返回空字符串
   */
  getTabSearchQuery: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    return tab?.searchQuery ?? ''
  },

  /**
   * 更新指定 Tab 的选中节点 ID
   * @param tabId - 目标 Tab id
   * @param nodeId - 选中的节点路径，null 表示取消选中
   */
  setTabSelectedNode: (tabId, nodeId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, selectedNodeId: nodeId } : t
      ),
    }))
  },

  /**
   * 读取指定 Tab 的选中节点 ID
   * @param tabId - 目标 Tab id
   * @returns 该 Tab 的选中节点路径，未选中时返回 null
   */
  getTabSelectedNode: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    return tab?.selectedNodeId ?? null
  },
}))

export const useTabStore = tabStore
