import { tabStore } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import type { GraphSession } from '../../stores/tabs/tabStore'
import { getRoomRef } from '../../domain/graph/path-utils'

export interface GraphNavigationDeps {
  tabId: string
  storeApi: StoreApi<GraphState>
  getActiveGraphSession: () => GraphSession
  saveNow: (roomRef: string) => Promise<void>
  loadRoom: (roomRef: string, isCreating?: boolean) => Promise<void>
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, storeApi, getActiveGraphSession, saveNow, loadRoom } = deps

  const clearSelection = () => {
    const store = storeApi.getState()
    let changed = false
    const nextNodes = store.nodes.map(n => {
      if (!n.selected) return n
      changed = true
      return { ...n, selected: false }
    })
    if (changed) store.setNodes(nextNodes)
  }

  const navigateBack = async () => {
    const roomRef = getActiveGraphSession().roomRef
    if (roomRef) await saveNow(roomRef)
    clearSelection()
    tabStore.getState().goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabStore.getState().getRoomHistoryLength(tabId)
    if (index < 0 || index >= historyLength) return

    const roomRef = getActiveGraphSession().roomRef
    if (roomRef) await saveNow(roomRef)
    clearSelection()

    const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(getRoomRef(target.kbId, target.id))
  }

  const navigateToRoot = async () => {
    const graphSession = getActiveGraphSession()
    const rootRoomId = graphSession.kbId
    const roomRef = graphSession.roomRef
    if (!rootRoomId) return
    if (roomRef) await saveNow(roomRef)
    clearSelection()
    tabStore.getState().restoreRootRoom(tabId, {
      kbId: graphSession.kbId,
      roomHistory: [],
      currentRoomId: rootRoomId,
      currentRoomName: graphSession.roomName || '全局',
    })
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
