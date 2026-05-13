import { tabStore, type Tab } from '../stores/tabStore'
import type { RoomHistoryItem } from '../types'
import type { RoomSnapshot, RoomTarget } from '../stores/tabTypes'

interface OpenKBTabInput {
  name: string
}

function snapshotFromTab(tab: Tab): RoomSnapshot | null {
  if (tab.type !== 'kb' || !tab.kbPath) return null
  const roomState = tabStore.getState().getRoomStateFromTab(tab.id)
  return {
    kbPath: tab.kbPath,
    roomHistory: roomState?.roomHistory ?? [],
    currentRoomPath: roomState?.currentRoomPath ?? tab.kbPath,
    currentRoomName: roomState?.currentRoomName || tab.label,
  }
}

export async function activateTab(tabId: string): Promise<boolean> {
  const tab = tabStore.getState().getTabById(tabId)
  if (!tab) return false
  tabStore.getState().setActiveTab(tabId)
  return true
}

export async function openHomeTab(): Promise<boolean> {
  return activateTab('home')
}

export async function openKBTab(kb: OpenKBTabInput): Promise<boolean> {
  const tabId = `kb:${kb.name}`
  const existing = tabStore.getState().getTabById(tabId)

  if (!existing) {
    tabStore.getState().addKBTab({
      id: tabId,
      label: kb.name,
      kbPath: kb.name,
    })
  }

  const tab = tabStore.getState().getTabById(tabId)
  if (!tab || tab.type !== 'kb') return false

  const snapshot = snapshotFromTab(tab) ?? {
    kbPath: kb.name,
    roomHistory: [],
    currentRoomPath: kb.name,
    currentRoomName: kb.name,
  }

  tabStore.getState().restoreRoomStateToTab(tabId, snapshot)
  tabStore.getState().setActiveTab(tabId)
  return true
}

export function closeTab(tabId: string) {
  const tab = tabStore.getState().getTabById(tabId)
  if (!tab || tab.id === 'home') return

  tabStore.getState().removeTab(tabId)
}

export function getClosableTabInfo(tabId: string) {
  const tab = tabStore.getState().getTabById(tabId)
  if (!tab || tab.id === 'home') return null
  return {
    id: tab.id,
    label: tab.label,
  }
}

export function enterRoomInTab(tabId: string, room: RoomTarget) {
  tabStore.getState().enterRoomInTab(tabId, room)
}

export function enterChildRoomInTab(tabId: string, child: { path: string; name: string }, kbPathFallback?: string) {
  const tab = tabStore.getState().getTabById(tabId)
  const kbPath = tab?.type === 'kb' ? tab.kbPath : kbPathFallback ?? child.path
  enterRoomInTab(tabId, { path: child.path, kbPath, name: child.name })
}

export function goBackInTab(tabId: string) {
  return tabStore.getState().goBackInTab(tabId)
}

export function getRoomHistoryLength(tabId: string) {
  return tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory.length ?? 0
}

export function navigateToHistoryIndexInTab(tabId: string, index: number) {
  return tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
}

export function restoreRootRoomInTab(tabId: string, snapshot: RoomSnapshot) {
  const tab = tabStore.getState().getTabById(tabId)
  if (tab?.type !== 'kb') return
  tabStore.getState().restoreRoomStateToTab(tabId, snapshot)
}
