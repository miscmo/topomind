export interface DefaultEdgeStyle {
  lineMode: 'smoothstep' | 'straight'
  lineStyle: 'solid' | 'dashed'
  color: string
  arrow: boolean
}

export interface DefaultNodeStyle {
  headerFontSize: number
  bodyFontSize: number
  headerColor: string
  headerBackgroundColor: string
  headerFontWeight: 'normal' | 'bold'
  headerFontStyle: 'normal' | 'italic'
  borderColor: string
  borderWidth: number
  borderRadius: number
}

export interface DefaultNodeSize {
  width: number
  height: number
}

export interface DefaultEditorStyle {
  fontSize: number
  fontFamily: string
  backgroundColor: string
  textColor: string
  lineHeight: number
}

export interface NodeSizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export interface StyleConfigDefaults {
  defaultEdgeStyle: DefaultEdgeStyle
  defaultNodeStyle: DefaultNodeStyle
  defaultNodeSize: DefaultNodeSize
  defaultEditorStyle: DefaultEditorStyle
  nodeSizeLimits: NodeSizeLimits
  nodeBadgeSize: number
}
