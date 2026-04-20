/**
 * TopoMind 核心类型定义
 * Barrel file — re-exports from domain and constant modules.
 * 对应 Vue 版本的数据结构，保证旧数据完全兼容。
 */
export type { AppView } from './graph'
export type { GraphChild, GraphEdge, GraphMeta } from './graph'
export type { EdgeRelation, EdgeWeight } from './graph'
export type {
  KnowledgeNodeData,
  KnowledgeNode,
  KnowledgeEdge,
} from './graph'
export type { Room, RoomHistoryItem } from './graph'
export type { EdgeModeState } from './graph'
export type { DirInfo, KBListItem } from './graph'

export { COLORS, LAYOUT, SIZES, DOMAIN_COLORS } from './constants'
