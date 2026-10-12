/**
 * 右侧面板的全局状态（Zustand）
 *
 * ⚠️ 历史背景：本 store 原先放在 `features/right-panel/model/`，但被 core（session-reset）、
 * application（commandRegistry）以及 documents / graph / layout / learning-tracker 等多个
 * feature 共同引用——它实质是**全局 UI 状态**，而非 right-panel 的内部实现。
 * 放在 features 下会造成 core / application 反向依赖 features 的分层倒置。
 *
 * 现统一到 `src/stores/`（与 graphStore / workspaceStore / monitorStore 同级），
 * 各使用方统一按 `@/stores/rightPanelStore` 引用。
 */
import { create } from 'zustand'
import type { RightPanelTab } from '../types/uiStoreTypes'

/** 右侧面板宽度下限兜底（像素），防止出现极小值/损坏值。真正可拖拽范围按窗口比例在容器层计算。 */
const RIGHT_PANEL_WIDTH_FLOOR = 280

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
  rightPanelWidth: 600,
  rightPanelTab: 'detail',
  stylePanelTab: 'nodes',
}

export const useRightPanelStore = create<RightPanelStore>((set) => ({
  ...RIGHT_PANEL_INITIAL_STATE,
  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),
  toggleRightPanelMaximized: () => set((state) => ({ rightPanelMaximized: !state.rightPanelMaximized })),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_FLOOR, Math.round(width)) }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setStylePanelTab: (stylePanelTab) => set({ stylePanelTab }),
  resetRightPanel: () => set({ ...RIGHT_PANEL_INITIAL_STATE }),
}))
