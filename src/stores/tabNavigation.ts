import type { RoomHistoryItem } from '../types'
import type { Tab } from './tabStore'

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

export function restoreRoomState(tab: Tab, roomState: RoomSnapshot): Tab {
  return {
    ...tab,
    kbPath: roomState.kbPath ?? tab.kbPath,
    roomHistory: roomState.roomHistory,
    currentRoomPath: roomState.currentRoomPath ?? undefined,
    currentRoomName: roomState.currentRoomName,
  }
}

export function enterRoom(tab: Tab, room: RoomTarget): Tab {
  if (tab.type !== 'kb') return tab

  const currentRoomPath = tab.currentRoomPath ?? tab.kbPath ?? null
  const currentRoomName = tab.currentRoomName ?? tab.label
  const baseKbPath = room.kbPath || tab.kbPath || ''

  if (currentRoomPath) {
    return {
      ...tab,
      kbPath: baseKbPath,
      roomHistory: [
        ...(tab.roomHistory ?? []),
        { room: { path: currentRoomPath, kbPath: baseKbPath, name: currentRoomName } },
      ],
      currentRoomPath: room.path,
      currentRoomName: room.name,
    }
  }

  return {
    ...tab,
    kbPath: baseKbPath,
    roomHistory: [],
    currentRoomPath: room.path,
    currentRoomName: room.name,
  }
}

export function goBack(tab: Tab): { tab: Tab; target: RoomTarget | null } {
  if (tab.type !== 'kb') return { tab, target: null }

  const history = tab.roomHistory ?? []
  if (history.length === 0) {
    return { tab, target: null }
  }

  const lastItem = history[history.length - 1]
  const newHistory = history.slice(0, -1)
  const kbPath = tab.kbPath || lastItem.room.kbPath || ''
  const target = {
    path: lastItem.room.path,
    kbPath: lastItem.room.kbPath || kbPath,
    name: lastItem.room.name,
  }

  return {
    target,
    tab: {
      ...tab,
      kbPath: target.kbPath,
      roomHistory: newHistory,
      currentRoomPath: target.path,
      currentRoomName: target.name,
    },
  }
}

export function navigateToHistoryIndex(tab: Tab, index: number): { tab: Tab; target: RoomTarget | null } {
  if (tab.type !== 'kb') return { tab, target: null }

  const history = tab.roomHistory ?? []
  if (index < 0 || index >= history.length) return { tab, target: null }

  const targetItem = history[index]
  const newHistory = history.slice(0, index)
  const kbPath = tab.kbPath || targetItem.room.kbPath || ''
  const target = {
    path: targetItem.room.path,
    kbPath: targetItem.room.kbPath || kbPath,
    name: targetItem.room.name,
  }

  return {
    target,
    tab: {
      ...tab,
      kbPath,
      roomHistory: newHistory,
      currentRoomPath: targetItem.room.path,
      currentRoomName: targetItem.room.name,
    },
  }
}
