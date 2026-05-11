import { useAppStore } from '../../stores/appStore'

export function useGraphStoreActions() {
  const clearSelection = useAppStore((s) => s.clearSelection)
  const defaultEdgeStyle = useAppStore((s) => s.defaultEdgeStyle)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)

  return {
    clearSelection,
    defaultEdgeStyle,
    setSelectedEdgeId,
    setRightPanelTab,
  }
}
