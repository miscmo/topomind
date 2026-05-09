import { tabStore } from '../../stores/tabStore'

export interface GraphNavigationDeps {
  tabId: string
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
    tabStore.getState().goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory.length ?? 0
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveNavState().roomPath
    if (dirPath) await saveNow(dirPath)
    clearSelection()

    const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(target.path)
  }

  const navigateToRoot = async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath
    const kbPath = navState.kbPath || dirPath || ''
    if (!kbPath) return
    if (dirPath) await saveNow(dirPath)
    clearSelection()
    const tab = tabStore.getState().getTabById(tabId)
    if (tab?.type === 'kb') {
      tabStore.getState().restoreRoomStateToTab(tabId, {
        kbPath,
        roomHistory: [],
        currentRoomPath: kbPath,
        currentRoomName: tab.label,
      })
    }
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
