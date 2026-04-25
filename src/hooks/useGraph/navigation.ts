import { tabStore } from '../../stores/tabStore'
import { roomStore } from '../../stores/roomStore'

export interface GraphNavigationDeps {
  tabId?: string
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  clearSelection: () => void
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, getActiveNavState, saveNow, loadRoom, clearSelection } = deps

  const navigateBack = async () => {
    const dirPath = getActiveNavState().roomPath
    if (dirPath) await saveNow(dirPath)
    clearSelection()
    if (tabId) {
      tabStore.getState().goBackInTab(tabId)
      return
    }
    roomStore.getState().goBack()
    const newPath = getActiveNavState().roomPath || getActiveNavState().kbPath || ''
    await loadRoom(newPath)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabId
      ? (tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory.length ?? 0)
      : roomStore.getState().roomHistory.length
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveNavState().roomPath
    if (dirPath) await saveNow(dirPath)
    clearSelection()

    if (tabId) {
      const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
      if (target) await loadRoom(target.path)
      return
    }

    roomStore.getState().navigateToHistoryIndex(index)
    const navState = getActiveNavState()
    await loadRoom(navState.roomPath || navState.kbPath || '')
  }

  const navigateToRoot = async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath
    const kbPath = navState.kbPath || dirPath || ''
    if (!kbPath) return
    if (dirPath) await saveNow(dirPath)
    clearSelection()
    if (tabId) {
      const tab = tabStore.getState().getTabById(tabId)
      if (tab?.type === 'kb') {
        tabStore.getState().restoreRoomStateToTab(tabId, {
          kbPath,
          roomHistory: [],
          currentRoomPath: kbPath,
          currentRoomName: tab.label,
        })
      }
      return
    }
    roomStore.getState().restoreRoomState({
      kbPath,
      roomHistory: [],
      currentRoomPath: kbPath,
      currentRoomName: navState.roomName || '全局',
    })
    await loadRoom(kbPath)
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
