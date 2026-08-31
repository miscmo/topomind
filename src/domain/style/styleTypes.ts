import type { EdgeArrowPosition, EdgeArrowShape } from '../../types/graph'

export interface DefaultEdgeStyle {
  lineMode: 'smoothstep' | 'straight'
  lineStyle: 'solid' | 'dashed'
  color: string
  /** 线条粗细（px）；主线在此基础上按比例加粗 */
  lineWidth: number
  arrow: boolean
  /** 箭头长度（px） */
  arrowSize: number
  /** 箭头形状：实心三角 / 空心 V 形 */
  arrowShape: EdgeArrowShape
  /** 箭头位置：仅终点 / 仅起点 / 两端都有 */
  arrowPosition: EdgeArrowPosition
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
  contentWidth: number
  blockSpacing: number
  headingSpacingRatio: number
  letterSpacing: number
  fontWeight: number
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
