import type { RoomHistoryItem } from '../../types'

export interface RoomTarget {
  id: string
  kbId: string
  name: string
}

export interface RoomSnapshot {
  roomHistory: RoomHistoryItem[]
  currentRoomId: string
  currentRoomName: string
  kbId: string
}

export interface RoomState {
  roomHistory: RoomHistoryItem[]
  currentRoomId: string
  currentRoomName: string
}

export interface CreateKBTabInput {
  id: string
  label: string
  kbId: string
}

export interface OpenKnowledgeBaseInput {
  id: string
  name: string
}

export interface ClosableTabInfo {
  id: string
  label: string
}

export interface GraphSession {
  tabId: string
  kbId: string
  roomId: string
  roomRef: string
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
  kbId: string
  roomHistory: RoomHistoryItem[]
  currentRoomId: string
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
  renameKBTab: (kbId: string, newLabel: string) => void
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
  enterChildRoom: (tabId: string, child: { id: string; name: string }) => void
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
