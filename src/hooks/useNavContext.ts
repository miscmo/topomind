/**
 * 导航上下文访问接口
 * 提供统一的导航状态读取接口，从 tabStore 读取当前 KB Tab 的导航状态。
 */
import { useCallback } from 'react'
import { tabStore } from '../stores/tabStore'

export interface NavState {
  kbPath: string
  roomPath: string
  roomName: string
  selectedNodeId: string | null
  setSelectedNodeId: (nodeId: string | null) => void
  clearSelectedNode: () => void
}

export interface UseNavContextOptions {
  /** 当前 KB tab 的 id */
  tabId: string
}

export function useNavContext(options: UseNavContextOptions) {
  const { tabId } = options

  const getNavState = useCallback((): NavState => {
    const tab = tabStore.getState().getTabById(tabId)
    if (tab && tab.type === 'kb' && tab.kbPath) {
      return {
        kbPath: tab.kbPath,
        roomPath: tab.currentRoomPath || tab.kbPath,
        roomName: tab.currentRoomName || tab.label,
        selectedNodeId: tab.selectedNodeId ?? null,
        setSelectedNodeId: (nodeId) => tabStore.getState().setTabSelectedNode(tabId, nodeId),
        clearSelectedNode: () => tabStore.getState().setTabSelectedNode(tabId, null),
      }
    }
    return {
      kbPath: '',
      roomPath: '',
      roomName: '',
      selectedNodeId: null,
      setSelectedNodeId: () => {},
      clearSelectedNode: () => {},
    }
  }, [tabId])

  return { getNavState }
}
