import type { EdgeRelation, EdgeWeight } from '../../../types'
import { CardInfo } from './card'
import { KBRef } from './kb'


interface KBNode {
  id: string
  card: CardInfo
  height: number
  width: number
}

interface KBEdge {
  id: string
  source: CardInfo
  target: CardInfo
  relation: EdgeRelation
  weight: EdgeWeight
  lineMode?: 'smoothstep' | 'straight'
  lineStyle?: 'solid' | 'dashed'
  color?: string
  arrow?: boolean
  highlighted?: boolean
  faded?: boolean
}

interface KBViewport {
  zoom: number
  pan: { x: number; y: number }
}


export interface GraphMeta {
  nodes: Record<string, KBNode>
  edges: KBEdge[]
  viewport: KBViewport
}

export interface IGraphStorage {
  readCardLayout: (kbRef: KBRef) => Promise<GraphMeta>
  writeCardLayout: (kbRef: KBRef, meta: GraphMeta) => Promise<void>
}
