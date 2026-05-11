import { useCallback } from 'react'
import { useAppStore } from '../../stores/appStore'

export function useRightPanelActions() {
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)

  const openEdgeStylePanel = useCallback((edgeId: string) => {
    setRightPanelTab('style')
    setSelectedEdgeId(edgeId)
  }, [setRightPanelTab, setSelectedEdgeId])

  return { openEdgeStylePanel }
}
