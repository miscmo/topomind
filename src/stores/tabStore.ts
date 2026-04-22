import { create } from 'zustand'
import type { RoomHistoryItem } from '../types'

export interface Tab {
  id: string
  type: 'home' | 'kb'
  label: string
  kbPath?: string
  isDirty: boolean
  // Per-tab room navigation state
  roomHistory?: RoomHistoryItem[]
  currentRoomPath?: string
  currentRoomName?: string
  // Per-tab UI state
  searchQuery?: string
  selectedNodeId?: string | null
}

interface TabState {
  tabs: Tab[]
  activeTabId: string

  initHomeTab: () => void
  addTab: (tab: Tab) => void
  addKBTab: (tab: { id: string; label: string; kbPath: string; isDirty?: boolean }) => void
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setTabDirty: (tabId: string, isDirty: boolean) => void
  getActiveTab: () => Tab | undefined
  getTabById: (tabId: string) => Tab | undefined
  saveRoomStateToTab: (tabId: string, roomState: { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string }) => void
  restoreRoomStateToTab: (tabId: string, roomState: { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string; kbPath?: string | null }) => void
  enterRoomInTab: (tabId: string, room: { path: string; kbPath: string; name: string }) => void
  goBackInTab: (tabId: string) => { path: string; kbPath: string; name: string } | null
  navigateToHistoryIndexInTab: (tabId: string, index: number) => { path: string; kbPath: string; name: string } | null
  getRoomStateFromTab: (tabId: string) => { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string } | null
  setTabSearchQuery: (tabId: string, query: string) => void
  getTabSearchQuery: (tabId: string) => string
  setTabSelectedNode: (tabId: string, nodeId: string | null) => void
  getTabSelectedNode: (tabId: string) => string | null
}

export const tabStore = create<TabState>()((set, get) => ({
  tabs: [],
  activeTabId: 'home',

  initHomeTab: () => {
    set({
      tabs: [{ id: 'home', type: 'home', label: '主页', isDirty: false }],
      activeTabId: 'home',
    })
  },

  addTab: (tab: Tab) => {
    set((state) => ({ tabs: [...state.tabs, tab] }))
  },

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

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },

  setTabDirty: (tabId: string, isDirty: boolean) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty } : t
      ),
    }))
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId)
  },

  getTabById: (tabId) => {
    return get().tabs.find((t) => t.id === tabId)
  },

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

  navigateToHistoryIndexInTab: (tabId, index) => {
    let target: { path: string; kbPath: string; name: string } | null = null

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== 'kb') return t

        const history = t.roomHistory ?? []
        if (index < 0 || index >= history.length) return t

        const targetItem = history[index]
        const newHistory = history.slice(0, index)

        if (newHistory.length === 0) {
          const kbPath = t.kbPath || targetItem.room.kbPath || ''
          target = { path: kbPath, kbPath, name: t.label }
          return {
            ...t,
            kbPath,
            roomHistory: [],
            currentRoomPath: kbPath,
            currentRoomName: t.label,
          }
        }

        target = {
          path: targetItem.room.path,
          kbPath: targetItem.room.kbPath,
          name: targetItem.room.name,
        }
        return {
          ...t,
          kbPath: targetItem.room.kbPath,
          roomHistory: newHistory,
          currentRoomPath: targetItem.room.path,
          currentRoomName: targetItem.room.name,
        }
      }),
    }))

    return target
  },

  getRoomStateFromTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return null
    return {
      roomHistory: tab.roomHistory ?? [],
      currentRoomPath: tab.currentRoomPath ?? null,
      currentRoomName: tab.currentRoomName ?? '全局',
    }
  },

  setTabSearchQuery: (tabId, query) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, searchQuery: query } : t
      ),
    }))
  },

  getTabSearchQuery: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    return tab?.searchQuery ?? ''
  },

  setTabSelectedNode: (tabId, nodeId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, selectedNodeId: nodeId } : t
      ),
    }))
  },

  getTabSelectedNode: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    return tab?.selectedNodeId ?? null
  },
}))

export const useTabStore = tabStore
