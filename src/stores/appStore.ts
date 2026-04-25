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
  showGitPanel: false,
  rightPanelCollapsed: false,
  rightPanelWidth: 320,
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    type: null as 'node' | 'edge' | 'pane' | null,
    targetId: null as string | null,
  },
  kbRefreshTrigger: 0,
  showGrid: true,
  searchQuery: '',
  rightPanelTab: 'detail' as 'detail' | 'style',
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
  // 是否显示 Git 面板
  showGitPanel: boolean
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
  // 搜索查询字符串
  searchQuery: string
  // 右侧面板当前 Tab
  rightPanelTab: 'detail' | 'style'
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
  showGraph: () => void
  showHome: () => void
  showSetup: () => void
  selectNode: (nodeId: string | null) => void
  clearSelection: () => void
  enterEdgeMode: (sourceId: string) => void
  exitEdgeMode: () => void
  toggleGitPanel: () => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  showContextMenu: (x: number, y: number, type: 'node' | 'edge' | 'pane', targetId?: string | null) => void
  hideContextMenu: () => void
  triggerKBRefresh: () => void
  toggleGrid: () => void
  setSearchQuery: (query: string) => void
  setRightPanelTab: (tab: 'detail' | 'style') => void
  setSelectedEdgeId: (edgeId: string | null) => void
  setDefaultEdgeStyle: (style: Partial<AppState['defaultEdgeStyle']>) => void
  replaceDefaultEdgeStyle: (style: AppState['defaultEdgeStyle']) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  ...APP_INITIAL_STATE,

  // Actions
  showGraph: () => set({ view: 'graph' }),
  showHome: () => set({ view: 'home' }),
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

  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),

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

  setSearchQuery: (query) => set({ searchQuery: query }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  setDefaultEdgeStyle: (style) => set((state) => ({
    defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
  })),

  replaceDefaultEdgeStyle: (style) => set({ defaultEdgeStyle: style }),

  reset: () => set({ ...APP_INITIAL_STATE }),
}))
