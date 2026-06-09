export type ContextMenuType = 'node' | 'edge' | 'pane' | null
export type RightPanelTab = 'detail' | 'style'

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  type: ContextMenuType
  targetId: string | null
}

export type {
  DefaultEdgeStyle,
  DefaultEditorStyle,
  DefaultNodeSize,
  DefaultNodeStyle,
  NodeSizeLimits,
} from '../domain/style/styleTypes'
