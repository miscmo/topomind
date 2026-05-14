import { tabStore } from '../../stores/tabStore'
import { useGraphStore } from '../../stores/graphStore'

export interface GraphNavigationDeps {
  tabId: string
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
}

export function buildGraphNavigation(deps: GraphNavigationDeps) {
  const { tabId, getActiveGraphSession, saveNow, loadRoom } = deps

  const clearSelection = () => {
    const store = useGraphStore.getState()
    const nextNodes = store.nodes.map(n => {
      if (!n.selected) return n
      return { ...n, selected: false }
    })
    store.setNodes(nextNodes)
  }

  const navigateBack = async () => {
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    clearSelection()
    tabStore.getState().goBackInTab(tabId)
  }

  const navigateToRoom = async (index: number) => {
    const historyLength = tabStore.getState().getRoomHistoryLength(tabId)
    if (index < 0 || index >= historyLength) return

    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    clearSelection()

    const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
    if (target) await loadRoom(target.path)
  }

  const navigateToRoot = async () => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const kbPath = graphSession.kbPath || dirPath || ''
    if (!kbPath) return
    if (dirPath) await saveNow(dirPath)
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
