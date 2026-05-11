import { useCallback } from 'react'
import { tabStore } from '../../stores/tabStore'

export function useGraphSelectionState(tabId: string) {
  const getActiveSelectedNodeId = useCallback(() => {
    return tabStore.getState().getTabSelectedNode(tabId)
  }, [tabId])

  const setActiveSelectedNodeId = useCallback((nodeId: string | null) => {
    tabStore.getState().setTabSelectedNode(tabId, nodeId)
  }, [tabId])

  return {
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
  }
}
