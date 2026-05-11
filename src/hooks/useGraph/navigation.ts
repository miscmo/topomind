import {
  getRoomHistoryLength,
  goBackInTab,
  navigateToHistoryIndexInTab,
  restoreRootRoomInTab,
} from '../../core/tab-flow'

export interface GraphNavigationDeps {
  tabId: string
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  deselectNode: () => void
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, getActiveNavState, saveNow, loadRoom, deselectNode } = deps

  const navigateBack = async () => {
    const dirPath = getActiveNavState().roomPath
    if (dirPath) await saveNow(dirPath)
    deselectNode()
    goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = getRoomHistoryLength(tabId)
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveNavState().roomPath
    if (dirPath) await saveNow(dirPath)
    deselectNode()

    const target = navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(target.path)
  }

  const navigateToRoot = async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath
    const kbPath = navState.kbPath || dirPath || ''
    if (!kbPath) return
    if (dirPath) await saveNow(dirPath)
    deselectNode()
    restoreRootRoomInTab(tabId, {
      kbPath,
      roomHistory: [],
      currentRoomPath: kbPath,
      currentRoomName: navState.roomName || '全局',
    })
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
