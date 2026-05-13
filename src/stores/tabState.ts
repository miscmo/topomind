import type { RoomState, Tab } from './tabTypes'

type KBTab = Extract<Tab, { type: 'kb' }>

export const TAB_INITIAL_STATE = {
  tabs: [] as Tab[],
  activeTabId: 'home',
}

export function ensureHomeTab(tabs: Tab[], activeTabId: string) {
  if (tabs.some((tab) => tab.id === 'home')) {
    return { tabs, activeTabId }
  }

  return {
    tabs: [{ id: 'home', type: 'home', label: '首页' } satisfies Tab, ...tabs],
    activeTabId: activeTabId || 'home',
  }
}

export function createKBTab(tab: { id: string; label: string; kbPath: string }): Tab {
  return {
    id: tab.id,
    type: 'kb',
    label: tab.label,
    kbPath: tab.kbPath,
    roomHistory: [],
    currentRoomPath: tab.kbPath,
    currentRoomName: tab.label,
    selectedNodeId: null,
  }
}

export function appendKBTab(tabs: Tab[], tab: { id: string; label: string; kbPath: string }) {
  if (tabs.some((item) => item.id === tab.id)) return tabs
  return [...tabs, createKBTab(tab)]
}

export function removeTabById(tabs: Tab[], activeTabId: string, tabId: string) {
  if (tabId === 'home') return { tabs, activeTabId }

  const closedIdx = tabs.findIndex((tab) => tab.id === tabId)
  const nextTabs = tabs.filter((tab) => tab.id !== tabId)

  if (activeTabId !== tabId) {
    return { tabs: nextTabs, activeTabId }
  }

  const fallbackIdx = Math.max(closedIdx - 1, 0)
  return {
    tabs: nextTabs,
    activeTabId: nextTabs[fallbackIdx]?.id ?? 'home',
  }
}

export function updateTabById(tabs: Tab[], tabId: string, update: (tab: Tab) => Tab) {
  return tabs.map((tab) => (tab.id === tabId ? update(tab) : tab))
}

export function updateKBTabById(tabs: Tab[], tabId: string, update: (tab: KBTab) => Tab) {
  return tabs.map((tab) => {
    if (tab.id !== tabId || tab.type !== 'kb') return tab
    return update(tab as KBTab)
  })
}

export function findTabById(tabs: Tab[], tabId: string) {
  return tabs.find((tab) => tab.id === tabId)
}

export function findActiveTab(tabs: Tab[], activeTabId: string) {
  return findTabById(tabs, activeTabId)
}

export function tabExists(tabs: Tab[], tabId: string) {
  return tabs.some((tab) => tab.id === tabId)
}

export function getRoomState(tab: Tab | undefined): RoomState | null {
  if (!tab || tab.type !== 'kb') return null
  return {
    roomHistory: tab.roomHistory,
    currentRoomPath: tab.currentRoomPath,
    currentRoomName: tab.currentRoomName,
  }
}

export function getSelectedNodeId(tab: Tab | undefined) {
  return tab?.type === 'kb' ? tab.selectedNodeId : null
}
