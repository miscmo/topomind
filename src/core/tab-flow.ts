import { tabStore, type Tab } from '../stores/tabStore'
import { flushTabs } from './close-guard'
import type { RoomHistoryItem } from '../types'

interface OpenKBTabInput {
  path: string
  name: string
}

interface RoomSnapshot {
  kbPath: string
  roomHistory: RoomHistoryItem[]
  currentRoomPath: string | null
  currentRoomName: string
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

async function flushCurrentTabBeforeLeaving(nextTabId: string): Promise<boolean> {
  const activeTab = tabStore.getState().getActiveTab()
  if (!activeTab || activeTab.id === nextTabId || !activeTab.isDirty) return true
  const result = await flushTabs([activeTab.id])
  return result.ok
}

export async function activateTab(tabId: string): Promise<boolean> {
  const tab = tabStore.getState().getTabById(tabId)
  if (!tab) return false
  if (!(await flushCurrentTabBeforeLeaving(tabId))) return false
  tabStore.getState().setActiveTab(tabId)
  return true
}

export async function openHomeTab(): Promise<boolean> {
  return activateTab('home')
}

export async function openKBTab(kb: OpenKBTabInput): Promise<boolean> {
  const tabId = `kb:${kb.path}`
  if (!(await flushCurrentTabBeforeLeaving(tabId))) {
    return false
  }
  const existing = tabStore.getState().getTabById(tabId)

  if (!existing) {
    tabStore.getState().addKBTab({
      id: tabId,
      label: kb.name,
      kbPath: kb.path,
      isDirty: false,
    })
  }

  const tab = tabStore.getState().getTabById(tabId)
  if (!tab || tab.type !== 'kb') return false

  const snapshot = snapshotFromTab(tab) ?? {
    kbPath: kb.path,
    roomHistory: [],
    currentRoomPath: kb.path,
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
