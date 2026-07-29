import { create } from 'zustand'
import type { RightPanelTab } from '../../../types/uiStoreTypes'

const RIGHT_PANEL_MIN_WIDTH = 600
const RIGHT_PANEL_MAX_WIDTH = 1200

interface RightPanelStore {
  rightPanelCollapsed: boolean
  rightPanelMaximized: boolean
  rightPanelWidth: number
  rightPanelTab: RightPanelTab
  collapseRightPanel: () => void
  expandRightPanel: () => void
  toggleRightPanelMaximized: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  resetRightPanel: () => void
}

export const RIGHT_PANEL_INITIAL_STATE: Pick<RightPanelStore, 'rightPanelCollapsed' | 'rightPanelMaximized' | 'rightPanelWidth' | 'rightPanelTab'> = {
  rightPanelCollapsed: false,
  rightPanelMaximized: false,
  rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
  rightPanelTab: 'detail',
}

export const useRightPanelStore = create<RightPanelStore>((set) => ({
  ...RIGHT_PANEL_INITIAL_STATE,
  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),
  toggleRightPanelMaximized: () => set((state) => ({ rightPanelMaximized: !state.rightPanelMaximized })),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, width)) }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  resetRightPanel: () => set({ ...RIGHT_PANEL_INITIAL_STATE }),
}))
