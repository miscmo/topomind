/**
 * TopoMind 核心类型定义
 * Barrel file — re-exports from domain and constant modules.
 * 对应 Vue 版本的数据结构，保证旧数据完全兼容。
 */
export type { AppView } from './graph'
export type { GraphChild, GraphEdge, GraphMeta } from './graph'
export type { EdgeRelation, EdgeWeight, EdgeLineMode, EdgeLineStyle } from './graph'
export type {
  KnowledgeNodeData,
  KnowledgeNodeStyle,
  KnowledgeNode,
  KnowledgeEdge,
} from './graph'
export type { Room, RoomHistoryItem } from './graph'
export type { KBListItem } from './graph'

export { COLORS, LAYOUT, SIZES, DOMAIN_COLORS } from './constants'
