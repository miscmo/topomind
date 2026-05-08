import type { EdgeRelation, EdgeWeight } from '../../../types'
import type { StorageRef } from './ref'

export interface StorageGraphMeta {
  children?: Record<string, {
    ref: StorageRef
    path: string
    name: string
    isDir: boolean
    order?: number
  }>
  edges?: Array<{
    id: string
    source: StorageRef
    target: StorageRef
    relation: EdgeRelation
    weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'
    lineStyle?: 'solid' | 'dashed'
    color?: string
    arrow?: boolean
    highlighted?: boolean
    faded?: boolean
  }>
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

export interface IGraphStorage {
  readCardLayout: (cardRef: StorageRef) => Promise<StorageGraphMeta>
  writeCardLayout: (cardRef: StorageRef, meta: StorageGraphMeta) => Promise<unknown>
}
