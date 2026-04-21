import { create } from 'zustand'

export interface Tab {
  id: string
  type: 'home' | 'kb'
  label: string
  kbPath?: string
  isDirty: boolean
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
}))

export const useTabStore = tabStore
