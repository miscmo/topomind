import type { RoomHistoryItem } from '../types'

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
  selectedNodeId: string | null
}

export type Tab = HomeTab | KBTab

export interface TabDataState {
  tabs: Tab[]
  activeTabId: string
}

export interface TabLifecycleActions {
  initHomeTab: () => void
  addKBTab: (tab: CreateKBTabInput) => void
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  reset: () => void
}

export interface TabSelectors {
  getActiveTab: () => Tab | undefined
  getTabById: (tabId: string) => Tab | undefined
}

export interface TabRoomActions {
  restoreRoomStateToTab: (tabId: string, roomState: RoomSnapshot) => void
  enterRoomInTab: (tabId: string, room: RoomTarget) => void
  goBackInTab: (tabId: string) => RoomTarget | null
  navigateToHistoryIndexInTab: (tabId: string, index: number) => RoomTarget | null
  getRoomStateFromTab: (tabId: string) => RoomState | null
}

export interface TabSelectionActions {
  setTabSelectedNode: (tabId: string, nodeId: string | null) => void
  getTabSelectedNode: (tabId: string) => string | null
}

export type TabState =
  TabDataState &
  TabLifecycleActions &
  TabSelectors &
  TabRoomActions &
  TabSelectionActions
