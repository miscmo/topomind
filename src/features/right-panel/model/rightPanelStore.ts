import { create } from 'zustand'
import type { RightPanelTab } from '../../../types/uiStoreTypes'

const RIGHT_PANEL_MIN_WIDTH = 600
const RIGHT_PANEL_MAX_WIDTH = 1200

/** 样式面板内部的小 Tab（节点 / 连线 / 编辑器） */
export type StylePanelTab = 'nodes' | 'edges' | 'editor'

interface RightPanelStore {
  rightPanelCollapsed: boolean
  rightPanelMaximized: boolean
  rightPanelWidth: number
  rightPanelTab: RightPanelTab
  stylePanelTab: StylePanelTab
  collapseRightPanel: () => void
  expandRightPanel: () => void
  toggleRightPanelMaximized: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setStylePanelTab: (tab: StylePanelTab) => void
  resetRightPanel: () => void
}

export const RIGHT_PANEL_INITIAL_STATE: Pick<RightPanelStore, 'rightPanelCollapsed' | 'rightPanelMaximized' | 'rightPanelWidth' | 'rightPanelTab' | 'stylePanelTab'> = {
  rightPanelCollapsed: false,
  rightPanelMaximized: false,
  rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
  rightPanelTab: 'detail',
  stylePanelTab: 'nodes',
}

export const useRightPanelStore = create<RightPanelStore>((set) => ({
  ...RIGHT_PANEL_INITIAL_STATE,
  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),
  toggleRightPanelMaximized: () => set((state) => ({ rightPanelMaximized: !state.rightPanelMaximized })),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, width)) }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setStylePanelTab: (stylePanelTab) => set({ stylePanelTab }),
  resetRightPanel: () => set({ ...RIGHT_PANEL_INITIAL_STATE }),
}))
