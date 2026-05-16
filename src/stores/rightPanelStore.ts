import { create } from 'zustand'
import type { RightPanelTab } from './uiStoreTypes'

interface RightPanelStore {
  rightPanelCollapsed: boolean
  rightPanelWidth: number
  rightPanelTab: RightPanelTab
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  resetRightPanel: () => void
}

export const RIGHT_PANEL_INITIAL_STATE: Pick<RightPanelStore, 'rightPanelCollapsed' | 'rightPanelWidth' | 'rightPanelTab'> = {
  rightPanelCollapsed: false,
  rightPanelWidth: 600,
  rightPanelTab: 'detail',
}

export const useRightPanelStore = create<RightPanelStore>((set) => ({
  ...RIGHT_PANEL_INITIAL_STATE,
  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),
  setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  resetRightPanel: () => set({ ...RIGHT_PANEL_INITIAL_STATE }),
}))
