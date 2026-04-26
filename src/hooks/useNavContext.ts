/**
 * 导航上下文访问接口
 * 提供统一的导航状态读取接口，支持 Tab-scoped 和全局状态两种模式。
 * Tab-scoped 模式下优先读取 tabStore 中的 Tab 专属状态，
 * 否则 fallback 到 roomStore/appStore 的全局状态。
 */
import { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { roomStore } from '../stores/roomStore'
import { tabStore } from '../stores/tabStore'

export interface NavState {
  kbPath: string
  roomPath: string
  roomName: string
  searchQuery: string
  selectedNodeId: string | null
  setSearchQuery: (query: string) => void
  setSelectedNodeId: (nodeId: string | null) => void
  clearSelectedNode: () => void
}

export interface UseNavContextOptions {
  /** Tab ID — if provided, reads Tab-scoped state; otherwise global roomStore */
  tabId?: string
}

export function useNavContext(options: UseNavContextOptions = {}) {
  const { tabId } = options

  const getNavState = useCallback((): NavState => {
    if (tabId) {
      const tab = tabStore.getState().getTabById(tabId)
      if (tab && tab.type === 'kb' && tab.kbPath) {
        return {
          kbPath: tab.kbPath,
          roomPath: tab.currentRoomPath || tab.kbPath,
          roomName: tab.currentRoomName || tab.label,
          searchQuery: tab.searchQuery ?? '',
          selectedNodeId: tab.selectedNodeId ?? null,
          setSearchQuery: (query) => tabStore.getState().setTabSearchQuery(tabId, query),
          setSelectedNodeId: (nodeId) => tabStore.getState().setTabSelectedNode(tabId, nodeId),
          clearSelectedNode: () => tabStore.getState().setTabSelectedNode(tabId, null),
        }
      }
    }
    const roomState = roomStore.getState()
    const appState = useAppStore.getState()
    return {
      kbPath: roomState.currentKBPath || '',
      roomPath: roomState.currentRoomPath || roomState.currentKBPath || '',
      roomName: roomState.currentRoomName || '全局',
      searchQuery: appState.searchQuery,
      selectedNodeId: appState.selectedNodeId,
      setSearchQuery: (query) => useAppStore.getState().setSearchQuery(query),
      setSelectedNodeId: (nodeId) => useAppStore.getState().selectNode(nodeId),
      clearSelectedNode: () => useAppStore.getState().clearSelection(),
    }
  }, [tabId])

  return { getNavState }
}
