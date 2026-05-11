/**
 * 应用全局状态管理（Zustand）
 * 替代 Vue3 Pinia 的 app store
 */
import { create } from 'zustand'
import type { AppView } from '@/types'

const APP_INITIAL_STATE = {
  view: 'setup' as AppView,
  rightPanelCollapsed: false,
  rightPanelWidth: 400,
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    type: null as 'node' | 'edge' | 'pane' | null,
    targetId: null as string | null,
  },
  showGrid: true,
  rightPanelTab: 'detail' as 'detail' | 'style',
  currentWorkDir: null as string | null,
  selectedEdgeId: null as string | null,
  defaultEdgeStyle: {
    lineMode: 'smoothstep' as 'smoothstep' | 'straight',
    lineStyle: 'solid' as 'solid' | 'dashed',
    color: '#7f8c8d',
    arrow: true,
  },
}

interface AppState {
  // 视图状态
  view: AppView
  // 右侧面板是否折叠
  rightPanelCollapsed: boolean
  // 右侧面板宽度
  rightPanelWidth: number
  // 右键菜单状态
  contextMenu: {
    visible: boolean
    x: number
    y: number
    type: 'node' | 'edge' | 'pane' | null
    targetId: string | null
  }
  // 是否显示网格背景
  showGrid: boolean
  // 右侧面板当前 Tab
  rightPanelTab: 'detail' | 'style'
  // 当前打开的工作目录
  currentWorkDir: string | null
  // 当前选中的连线 ID
  selectedEdgeId: string | null
  // 全局默认连线样式
  defaultEdgeStyle: {
    lineMode: 'smoothstep' | 'straight'
    lineStyle: 'solid' | 'dashed'
    color: string
    arrow: boolean
  }

  // Actions
  showWorkspace: () => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  showContextMenu: (x: number, y: number, type: 'node' | 'edge' | 'pane', targetId?: string | null) => void
  hideContextMenu: () => void
  setRightPanelTab: (tab: 'detail' | 'style') => void
  setCurrentWorkDir: (workDir: string | null) => void
  setSelectedEdgeId: (edgeId: string | null) => void
  setDefaultEdgeStyle: (style: Partial<AppState['defaultEdgeStyle']>) => void
  replaceDefaultEdgeStyle: (style: AppState['defaultEdgeStyle']) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  ...APP_INITIAL_STATE,

  // Actions
  showWorkspace: () => set({ view: 'workspace' }),

  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  showContextMenu: (x, y, type, targetId = null) => set({
    contextMenu: { visible: true, x, y, type, targetId },
  }),

  hideContextMenu: () => set((state) => ({
    contextMenu: { ...state.contextMenu, visible: false },
  })),

  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  setDefaultEdgeStyle: (style) => set((state) => ({
    defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
  })),

  replaceDefaultEdgeStyle: (style) => set({ defaultEdgeStyle: style }),

  reset: () => set({ ...APP_INITIAL_STATE }),
}))
