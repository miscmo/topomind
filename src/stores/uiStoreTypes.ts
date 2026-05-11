import type { AppView } from '@/types'

export type ContextMenuType = 'node' | 'edge' | 'pane' | null
export type RightPanelTab = 'detail' | 'style'

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  type: ContextMenuType
  targetId: string | null
}

export interface DefaultEdgeStyle {
  lineMode: 'smoothstep' | 'straight'
  lineStyle: 'solid' | 'dashed'
  color: string
  arrow: boolean
}

export interface WorkspaceStoreState {
  view: AppView
  currentWorkDir: string | null
  showWorkspace: () => void
  setCurrentWorkDir: (workDir: string | null) => void
}

export interface RightPanelStoreState {
  rightPanelCollapsed: boolean
  rightPanelWidth: number
  rightPanelTab: RightPanelTab
  collapseRightPanel: () => void
  expandRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: RightPanelTab) => void
}

export interface ContextMenuStoreState {
  contextMenu: ContextMenuState
  showContextMenu: (x: number, y: number, type: Exclude<ContextMenuType, null>, targetId?: string | null) => void
  hideContextMenu: () => void
}

export interface GraphUiStoreState {
  showGrid: boolean
  selectedEdgeId: string | null
  defaultEdgeStyle: DefaultEdgeStyle
  setSelectedEdgeId: (edgeId: string | null) => void
  setDefaultEdgeStyle: (style: Partial<DefaultEdgeStyle>) => void
  replaceDefaultEdgeStyle: (style: DefaultEdgeStyle) => void
}

