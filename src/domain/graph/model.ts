import type { EdgeRelation, EdgeWeight, EdgeLineMode, EdgeLineStyle, KnowledgeNodeStyle, NodeSizingMode } from '../../types'

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
  arrow?: boolean
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
  arrow?: boolean
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
