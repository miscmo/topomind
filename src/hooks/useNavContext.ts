/**
 * 导航上下文访问接口
 * 提供统一的导航状态读取接口，从 tabStore 读取当前 KB Tab 的导航状态。
 */
import { useCallback, useMemo } from 'react'
import { tabStore, useTabStore } from '../stores/tabStore'

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

const emptyNavState = (): NavState => ({
  kbPath: '',
  roomPath: '',
  roomName: '',
  selectedNodeId: null,
  setSelectedNodeId: () => {},
  clearSelectedNode: () => {},
})

export function getNavStateForTab(tabId: string): NavState {
  const tab = tabStore.getState().getTabById(tabId)
  if (!tab || tab.type !== 'kb' || !tab.kbPath) {
    return emptyNavState()
  }

  return {
    kbPath: tab.kbPath,
    roomPath: tab.currentRoomPath || tab.kbPath,
    roomName: tab.currentRoomName || tab.label,
    selectedNodeId: tab.selectedNodeId ?? null,
    setSelectedNodeId: (nodeId) => tabStore.getState().setTabSelectedNode(tabId, nodeId),
    clearSelectedNode: () => tabStore.getState().setTabSelectedNode(tabId, null),
  }
}

export function useNavContext(options: UseNavContextOptions) {
  const { tabId } = options
  const tab = useTabStore((s) => s.getTabById(tabId))

  const nav = useMemo<NavState>(() => {
    if (!tab || tab.type !== 'kb' || !tab.kbPath) {
      return emptyNavState()
    }

    return {
      kbPath: tab.kbPath,
      roomPath: tab.currentRoomPath || tab.kbPath,
      roomName: tab.currentRoomName || tab.label,
      selectedNodeId: tab.selectedNodeId ?? null,
      setSelectedNodeId: (nodeId) => tabStore.getState().setTabSelectedNode(tabId, nodeId),
      clearSelectedNode: () => tabStore.getState().setTabSelectedNode(tabId, null),
    }
  }, [tab, tabId])

  const getNavState = useCallback((): NavState => {
    return getNavStateForTab(tabId)
  }, [tabId])

  return { nav, getNavState }
}
