import { tabStore } from '../../stores/tabStore'

export interface GraphNavigationDeps {
  tabId: string
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  deselectNode: () => void
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, getActiveGraphSession, saveNow, loadRoom, deselectNode } = deps

  const navigateBack = async () => {
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    deselectNode()
    tabStore.getState().goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabStore.getState().getRoomHistoryLength(tabId)
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    deselectNode()

    const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(target.path)
  }

  const navigateToRoot = async () => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const kbPath = graphSession.kbPath || dirPath || ''
    if (!kbPath) return
    if (dirPath) await saveNow(dirPath)
    deselectNode()
    tabStore.getState().restoreRootRoom(tabId, {
      kbPath,
      roomHistory: [],
      currentRoomPath: kbPath,
      currentRoomName: graphSession.roomName || '全局',
    })
  }

  return { navigateBack, navigateToRoom, navigateToRoot }
}
