export type ContextMenuType = 'node' | 'edge' | 'pane' | null
export type RightPanelTab = 'detail' | 'card' | 'style'

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
