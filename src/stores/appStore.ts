/**
 * 应用全局状态管理（Zustand）
 * 替代 Vue3 Pinia 的 app store
 */
import { create } from 'zustand'
import type { AppView } from '@/types'

const APP_INITIAL_STATE = {
  view: 'setup' as AppView,
  selectedNodeId: null as string | null,
  edgeMode: false,
  edgeModeSourceId: null as string | null,
  rightPanelCollapsed: false,
  rightPanelWidth: 400,
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    type: null as 'node' | 'edge' | 'pane' | null,
    targetId: null as string | null,
  },
  kbRefreshTrigger: 0,
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
  // 当前选中节点 ID
  selectedNodeId: string | null
  // 连线模式
  edgeMode: boolean
  // 连线模式源节点 ID
  edgeModeSourceId: string | null
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
  // KB 列表刷新触发器（NavTree 监听此字段以保持同步）
  kbRefreshTrigger: number
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
  showSetup: () => void
  selectNode: (nodeId: string | null) => void
  clearSelection: () => void
  enterEdgeMode: (sourceId: string) => void
  exitEdgeMode: () => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  showContextMenu: (x: number, y: number, type: 'node' | 'edge' | 'pane', targetId?: string | null) => void
  hideContextMenu: () => void
  triggerKBRefresh: () => void
  toggleGrid: () => void
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
  showSetup: () => set({ view: 'setup' }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  clearSelection: () => set({
    selectedNodeId: null,
    edgeMode: false,
    edgeModeSourceId: null,
  }),

  enterEdgeMode: (sourceId) => set({
    edgeMode: true,
    edgeModeSourceId: sourceId,
  }),

  exitEdgeMode: () => set({
    edgeMode: false,
    edgeModeSourceId: null,
  }),

  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  showContextMenu: (x, y, type, targetId = null) => set({
    contextMenu: { visible: true, x, y, type, targetId },
  }),

  hideContextMenu: () => set((state) => ({
    ...state,
    contextMenu: { ...state.contextMenu, visible: false },
  })),

  triggerKBRefresh: () => set((state) => ({ kbRefreshTrigger: state.kbRefreshTrigger + 1 })),

  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  setDefaultEdgeStyle: (style) => set((state) => ({
    defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
  })),

  replaceDefaultEdgeStyle: (style) => set({ defaultEdgeStyle: style }),

  reset: () => set({ ...APP_INITIAL_STATE }),
}))
