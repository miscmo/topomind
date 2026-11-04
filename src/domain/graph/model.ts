import type { EdgeRelation, EdgeWeight, EdgeLineMode, EdgeLineStyle, EdgeArrowShape, EdgeArrowPosition, KnowledgeNodeStyle, NodeSizingMode } from '../../types'
import type { EdgeAnchor } from './edgeAnchors'

export interface CardInfo {
  ref: string
  name: string
  updatedAt?: string
}

export interface GraphPoint {
  x: number
  y: number
}

export interface GraphSize {
  width: number
  height: number
}

export interface RoomGraphNode {
  id: string
  cardRef: string
  name: string
  position?: GraphPoint
  size?: GraphSize
  widthMode?: NodeSizingMode
  heightMode?: NodeSizingMode
  expanded?: boolean
  color?: string
  style?: KnowledgeNodeStyle
  expandedWidth?: number
  expandedHeight?: number
  emojis?: string[]
}

export interface RoomGraphEdge {
  id: string
  sourceRef: string
  targetRef: string
  relation: EdgeRelation
  weight: EdgeWeight
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  /** 线条粗细（px） */
  lineWidth?: number
  arrow?: boolean
  /** 箭头长度（px） */
  arrowSize?: number
  arrowShape?: EdgeArrowShape
  arrowPosition?: EdgeArrowPosition
  /** 曲线弯曲度：归一化 [-1, 1]，0 ≈ 直线；仅 lineMode='curve' 时生效 */
  curveBend?: number | null
  /** 起点端 / 终点端锚点（节点边框上的归一化位置，只决定出线位置），绑定在本条边上 */
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  highlighted?: boolean
  faded?: boolean
}

export interface RoomGraphViewport {
  zoom: number
  pan: GraphPoint
}

export interface KBNode {
  id: string
  card: CardInfo
  height: number
  width: number
  widthMode?: NodeSizingMode
  heightMode?: NodeSizingMode
  position?: GraphPoint
  expanded?: boolean
  color?: string
  style?: KnowledgeNodeStyle
  expandedWidth?: number
  expandedHeight?: number
  emojis?: string[]
}

export interface KBEdge {
  id: string
  source: CardInfo
  target: CardInfo
  relation: EdgeRelation
  weight: EdgeWeight
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  /** 线条粗细（px） */
  lineWidth?: number
  arrow?: boolean
  /** 箭头长度（px） */
  arrowSize?: number
  arrowShape?: EdgeArrowShape
  arrowPosition?: EdgeArrowPosition
  /** 曲线弯曲度：归一化 [-1, 1]，0 ≈ 直线；仅 lineMode='curve' 时生效 */
  curveBend?: number | null
  /** 起点端 / 终点端锚点（节点边框上的归一化位置，只决定出线位置），绑定在本条边上 */
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  highlighted?: boolean
  faded?: boolean
}

export interface GraphMeta {
  nodes: Record<string, KBNode>
  edges: KBEdge[]
  viewport: RoomGraphViewport
}

export interface RoomGraph {
  roomRef: string
  nodes: Record<string, RoomGraphNode>
  edges: RoomGraphEdge[]
  viewport: RoomGraphViewport
}

export const DEFAULT_VIEWPORT: RoomGraphViewport = {
  zoom: 1,
  pan: { x: 0, y: 0 },
}

export const DEFAULT_NODE_SIZE: GraphSize = {
  width: 120,
  height: 52,
}
