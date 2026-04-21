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
}

interface TabState {
  tabs: Tab[]
  activeTabId: string

  initHomeTab: () => void
  addTab: (tab: Tab) => void
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setTabDirty: (tabId: string, isDirty: boolean) => void
  getActiveTab: () => Tab | undefined
  saveRoomStateToTab: (tabId: string, roomState: { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string }) => void
  getRoomStateFromTab: (tabId: string) => { roomHistory: RoomHistoryItem[]; currentRoomPath: string | null; currentRoomName: string } | null
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

  getRoomStateFromTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return null
    return {
      roomHistory: tab.roomHistory ?? [],
      currentRoomPath: tab.currentRoomPath ?? null,
      currentRoomName: tab.currentRoomName ?? '全局',
    }
  },
}))

export const useTabStore = tabStore
