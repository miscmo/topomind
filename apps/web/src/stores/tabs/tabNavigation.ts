import type { KBTab, RoomSnapshot, RoomTarget, Tab } from './tabTypes'

export function restoreRoomState(tab: KBTab, roomState: RoomSnapshot): KBTab {
  return {
    ...tab,
    kbId: roomState.kbId,
    roomHistory: roomState.roomHistory,
    currentRoomId: roomState.currentRoomId,
    currentRoomName: roomState.currentRoomName,
  }
}

export function enterRoom(tab: KBTab, room: RoomTarget): KBTab {
  const currentRoomId = tab.currentRoomId ?? tab.kbId
  const currentRoomName = tab.currentRoomName ?? tab.label

  return {
    ...tab,
    kbId: room.kbId,
    roomHistory: [
      ...(tab.roomHistory ?? []),
      { room: { id: currentRoomId, kbId: tab.kbId, name: currentRoomName } },
    ],
    currentRoomId: room.id,
    currentRoomName: room.name,
  }
}

export function goBack(tab: KBTab): { tab: KBTab; target: RoomTarget | null } {
  const history = tab.roomHistory ?? []
  if (history.length === 0) {
    return { tab, target: null }
  }

  const lastItem = history[history.length - 1]
  const newHistory = history.slice(0, -1)
  const target = {
    id: lastItem.room.id,
    kbId: lastItem.room.kbId,
    name: lastItem.room.name,
  }

  return {
    target,
    tab: {
      ...tab,
      kbId: target.kbId,
      roomHistory: newHistory,
      currentRoomId: target.id,
      currentRoomName: target.name,
    },
  }
}

export function navigateToHistoryIndex(tab: KBTab, index: number): { tab: KBTab; target: RoomTarget | null } {
  const history = tab.roomHistory ?? []
  if (index < 0 || index >= history.length) return { tab, target: null }

  const targetItem = history[index]
  const newHistory = history.slice(0, index)
  const target = {
    id: targetItem.room.id,
    kbId: targetItem.room.kbId,
    name: targetItem.room.name,
  }

  return {
    target,
    tab: {
      ...tab,
      kbId: target.kbId,
      roomHistory: newHistory,
      currentRoomId: target.id,
      currentRoomName: targetItem.room.name,
    },
  }
}
