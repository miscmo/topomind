import type { RoomHistoryItem } from '../../types'

export interface RoomTarget {
  path: string
  kbPath: string
  name: string
}

export interface RoomSnapshot {
  roomHistory: RoomHistoryItem[]
  currentRoomPath: string | null
  currentRoomName: string
  kbPath?: string | null
}

export interface RoomState {
  roomHistory: RoomHistoryItem[]
  currentRoomPath: string | null
  currentRoomName: string
}

export interface CreateKBTabInput {
  id: string
  label: string
  kbPath: string
}

export interface OpenKnowledgeBaseInput {
  name: string
}

export interface ClosableTabInfo {
  id: string
  label: string
}

export interface GraphSession {
  tabId: string
  kbPath: string
  roomPath: string
  roomName: string
}

export interface HomeTab {
  id: 'home'
  type: 'home'
  label: string
}

export interface KBTab {
  id: string
  type: 'kb'
  label: string
  kbPath: string
  roomHistory: RoomHistoryItem[]
  currentRoomPath: string
  currentRoomName: string
}

export interface MonitorTab {
  id: 'monitor'
  type: 'monitor'
  label: string
}

export interface StatisticsTab {
  id: 'statistics'
  type: 'statistics'
  label: string
}

export type Tab = HomeTab | KBTab | MonitorTab | StatisticsTab

export interface TabDataState {
  tabs: Tab[]
  activeTabId: string
}

export interface TabLifecycleActions {
  initHomeTab: () => void
  addKBTab: (tab: CreateKBTabInput) => void
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  activateTab: (tabId: string) => boolean
  openHomeTab: () => boolean
  openKnowledgeBase: (kb: OpenKnowledgeBaseInput) => boolean
  openMonitorTab: () => void
  openStatisticsTab: () => void
  closeTab: (tabId: string) => ClosableTabInfo | null
  renameKBTab: (oldKbPath: string, newKbPath: string) => void
  reset: () => void
}

export interface TabSelectors {
  getActiveTab: () => Tab | undefined
  getTabById: (tabId: string) => Tab | undefined
  getGraphSession: (tabId: string) => GraphSession
  getRoomHistoryLength: (tabId: string) => number
  getClosableTabInfo: (tabId: string) => ClosableTabInfo | null
}

export interface TabRoomActions {
  restoreRoomStateToTab: (tabId: string, roomState: RoomSnapshot) => void
  enterRoomInTab: (tabId: string, room: RoomTarget) => void
  enterChildRoom: (tabId: string, child: { path: string; name: string }, kbPathFallback?: string) => void
  goBackInTab: (tabId: string) => RoomTarget | null
  navigateToHistoryIndexInTab: (tabId: string, index: number) => RoomTarget | null
  restoreRootRoom: (tabId: string, snapshot: RoomSnapshot) => void
  getRoomStateFromTab: (tabId: string) => RoomState | null
}

export type TabState =
  TabDataState &
  TabLifecycleActions &
  TabSelectors &
  TabRoomActions
