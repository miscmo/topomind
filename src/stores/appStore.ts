/**
 * 应用全局状态管理（Zustand）
 * 替代 Vue3 Pinia 的 app store
 */
import { create } from 'zustand'
import type { AppView } from '@/types'

interface AppState {
  // 视图状态
  view: AppView
  // 当前选中节点 ID
  selectedNodeId: string | null
  // 连线模式
  edgeMode: boolean
  // 连线模式源节点 ID
  edgeModeSourceId: string | null
  // 自动 ID 计数器
  autoIdCounter: number
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

  // Actions
  showGraph: () => void
  showHome: () => void
  showSetup: () => void
  selectNode: (nodeId: string | null) => void
  clearSelection: () => void
  enterEdgeMode: (sourceId: string) => void
  exitEdgeMode: () => void
  autoId: () => string
  toggleGitPanel: () => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  showContextMenu: (x: number, y: number, type: 'node' | 'edge' | 'pane', targetId?: string | null) => void
  hideContextMenu: () => void
  triggerKBRefresh: () => void
  toggleGrid: () => void
  setSearchQuery: (query: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  view: 'setup',
  selectedNodeId: null,
  edgeMode: false,
  edgeModeSourceId: null,
  autoIdCounter: 0,
  showGitPanel: false,
  rightPanelCollapsed: false,
  rightPanelWidth: 320,
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    type: null,
    targetId: null,
  },
  kbRefreshTrigger: 0,
  showGrid: true,
  searchQuery: '',

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

  autoId: () => {
    const id = `auto-${Date.now()}-${get().autoIdCounter}`
    set((state) => ({ autoIdCounter: state.autoIdCounter + 1 }))
    return id
  },

  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),

  collapseRightPanel: () => set({ rightPanelCollapsed: true }),
  expandRightPanel: () => set({ rightPanelCollapsed: false }),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  showContextMenu: (x, y, type, targetId = null) => set({
    contextMenu: { visible: true, x, y, type, targetId },
  }),

  hideContextMenu: () => set((state) => ({
    contextMenu: { ...state.contextMenu, visible: false },
  })),

  triggerKBRefresh: () => set((state) => ({ kbRefreshTrigger: state.kbRefreshTrigger + 1 })),

  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  setSearchQuery: (query) => set({ searchQuery: query }),
}))
