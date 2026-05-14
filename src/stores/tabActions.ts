import type { StoreApi } from 'zustand'
import { enterRoom, goBack, navigateToHistoryIndex, restoreRoomState } from './tabNavigation'
import {
  appendKBTab,
  ensureHomeTab,
  findActiveTab,
  findTabById,
  getClosableTabInfo,
  getGraphSession,
  getRoomState,
  getRoomHistoryLength,
  getRoomSnapshot,
  getSelectedNodeId,
  removeTabById,
  tabExists,
  TAB_INITIAL_STATE,
  updateKBTabById,
} from './tabState'
import type {
  RoomTarget,
  TabLifecycleActions,
  TabRoomActions,
  TabSelectors,
  TabSelectionActions,
  TabState,
} from './tabTypes'

type SetState = StoreApi<TabState>['setState']
type GetState = StoreApi<TabState>['getState']

export function createTabLifecycleActions(set: SetState, get: GetState): TabLifecycleActions {
  return {
    initHomeTab: () => {
      set((state) => {
        const next = ensureHomeTab(state.tabs, state.activeTabId)
        return next.tabs === state.tabs && next.activeTabId === state.activeTabId ? state : next
      })
    },
    addKBTab: ({ id, label, kbPath }) => {
      set((state) => {
        const tabs = appendKBTab(state.tabs, { id, label, kbPath })
        return tabs === state.tabs ? state : { tabs }
      })
    },
    removeTab: (tabId) => {
      const { tabs, activeTabId } = get()
      set(removeTabById(tabs, activeTabId, tabId))
    },
    setActiveTab: (tabId) => {
      if (!tabExists(get().tabs, tabId)) return
      set({ activeTabId: tabId })
    },
    activateTab: (tabId) => {
      if (!tabExists(get().tabs, tabId)) return false
      set({ activeTabId: tabId })
      return true
    },
    openHomeTab: () => {
      return get().activateTab('home')
    },
    openKnowledgeBase: (kb) => {
      const tabId = `kb:${kb.name}`
      const existing = findTabById(get().tabs, tabId)

      if (!existing) {
        get().addKBTab({
          id: tabId,
          label: kb.name,
          kbPath: kb.name,
        })
      }

      const tab = findTabById(get().tabs, tabId)
      if (!tab || tab.type !== 'kb') return false

      const snapshot = getRoomSnapshot(tab) ?? {
        kbPath: kb.name,
        roomHistory: [],
        currentRoomPath: kb.name,
        currentRoomName: kb.name,
      }

      get().restoreRoomStateToTab(tabId, snapshot)
      set({ activeTabId: tabId })
      return true
    },
    closeTab: (tabId) => {
      const tabInfo = getClosableTabInfo(findTabById(get().tabs, tabId))
      if (!tabInfo) return null
      get().removeTab(tabId)
      return tabInfo
    },
    reset: () => set({ ...TAB_INITIAL_STATE }),
  }
}

export function createTabSelectors(get: GetState): TabSelectors {
  return {
    getActiveTab: () => {
      const { tabs, activeTabId } = get()
      return findActiveTab(tabs, activeTabId)
    },
    getTabById: (tabId) => findTabById(get().tabs, tabId),
    getGraphSession: (tabId) => getGraphSession(tabId, findTabById(get().tabs, tabId)),
    getRoomHistoryLength: (tabId) => getRoomHistoryLength(findTabById(get().tabs, tabId)),
    getClosableTabInfo: (tabId) => getClosableTabInfo(findTabById(get().tabs, tabId)),
  }
}

export function createTabRoomActions(set: SetState, get: GetState): TabRoomActions {
  return {
    restoreRoomStateToTab: (tabId, roomState) => {
      set((state) => ({
        tabs: updateKBTabById(state.tabs, tabId, (tab) => restoreRoomState(tab, roomState)),
      }))
    },
    enterRoomInTab: (tabId, room) => {
      set((state) => ({
        tabs: updateKBTabById(state.tabs, tabId, (tab) => enterRoom(tab, room)),
      }))
    },
    enterChildRoom: (tabId, child, kbPathFallback) => {
      const tab = findTabById(get().tabs, tabId)
      const kbPath = tab?.type === 'kb' ? tab.kbPath : kbPathFallback ?? child.path
      get().enterRoomInTab(tabId, { path: child.path, kbPath, name: child.name })
    },
    goBackInTab: (tabId) => {
      let target: RoomTarget | null = null

      set((state) => ({
        tabs: updateKBTabById(state.tabs, tabId, (tab) => {
          const result = goBack(tab)
          target = result.target
          return result.tab
        }),
      }))

      return target
    },
    navigateToHistoryIndexInTab: (tabId, index) => {
      let target: RoomTarget | null = null

      set((state) => ({
        tabs: updateKBTabById(state.tabs, tabId, (tab) => {
          const result = navigateToHistoryIndex(tab, index)
          target = result.target
          return result.tab
        }),
      }))

      return target
    },
    restoreRootRoom: (tabId, snapshot) => {
      const tab = findTabById(get().tabs, tabId)
      if (tab?.type !== 'kb') return
      get().restoreRoomStateToTab(tabId, snapshot)
    },
    getRoomStateFromTab: (tabId) => getRoomState(findTabById(get().tabs, tabId)),
  }
}

export function createTabSelectionActions(set: SetState, get: GetState): TabSelectionActions {
  return {
    setTabSelectedNode: (tabId: string, nodeId: string | null) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return state
      const newTabs = [...state.tabs]
      const tab = newTabs[idx]
      if (tab.type === 'kb') {
        newTabs[idx] = { ...tab, selectedNodeId: nodeId }
      }
      return { tabs: newTabs }
    })
  },
    getTabSelectedNode: (tabId) => getSelectedNodeId(findTabById(get().tabs, tabId)),
  }
}
