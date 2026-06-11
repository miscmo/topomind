import { tabStore } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import type { GraphSaveSnapshot } from './graphOperations'

export interface GraphNavigationDeps {
  tabId: string
  storeApi: StoreApi<GraphState>
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  captureSaveSnapshot: (dirPath: string) => GraphSaveSnapshot | null
  saveSnapshot: (snapshot: GraphSaveSnapshot | null) => Promise<void>
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, storeApi, getActiveGraphSession, captureSaveSnapshot, saveSnapshot, loadRoom } = deps

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
    const dirPath = getActiveGraphSession().roomPath
    const snapshot = dirPath ? captureSaveSnapshot(dirPath) : null
    if (snapshot) await saveSnapshot(snapshot)
    clearSelection()
    tabStore.getState().goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabStore.getState().getRoomHistoryLength(tabId)
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveGraphSession().roomPath
    const snapshot = dirPath ? captureSaveSnapshot(dirPath) : null
    if (snapshot) await saveSnapshot(snapshot)
    clearSelection()

    const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(target.path)
  }

  const navigateToRoot = async () => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const kbPath = graphSession.kbPath || dirPath || ''
    if (!kbPath) return
    const snapshot = dirPath ? captureSaveSnapshot(dirPath) : null
    if (snapshot) await saveSnapshot(snapshot)
    clearSelection()
    tabStore.getState().restoreRootRoom(tabId, {
      kbPath,
      roomHistory: [],
      currentRoomPath: kbPath,
      currentRoomName: graphSession.roomName || '全局',
    })
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
