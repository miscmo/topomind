import { create } from 'zustand'
import type { RightPanelStoreState } from './uiStoreTypes'

interface RightPanelStore extends RightPanelStoreState {
  resetRightPanel: () => void
}

export const RIGHT_PANEL_INITIAL_STATE: Pick<RightPanelStoreState, 'rightPanelCollapsed' | 'rightPanelWidth' | 'rightPanelTab'> = {
  rightPanelCollapsed: false,
  rightPanelWidth: 400,
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
