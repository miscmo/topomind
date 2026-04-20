/**
 * TopoMind Domain Types
 * Pure domain model types — no UI constants here.
 * See constants.ts for visual/design constants.
 */
import type { Node, Edge } from '@xyflow/react'

// ============== 视图状态 ==============

/** 应用视图类型 */
export type AppView = 'setup' | 'home' | 'graph'

// ============== 图谱元数据 ==============

/**
 * _graph.json 中的 children 条目
 * key = 目录名（唯一），name = 显示名称（可不同）
 */
export interface GraphChild {
  name: string
}

/**
 * _graph.json 中的 edges 条目
 */
export interface GraphEdge {
  id: string
  source: string
  target: string
  relation: EdgeRelation
  weight: EdgeWeight
}

/**
 * _graph.json 完整结构
 */
export interface GraphMeta {
  children?: Record<string, GraphChild>
  edges?: GraphEdge[]
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

// ============== 边类型 ==============

/** 关系类型 */
export type EdgeRelation = '演进' | '依赖' | '相关'

/** 边权重（决定主线/次线） */
export type EdgeWeight = 'main' | 'minor'

// ============== React Flow 节点/边 ==============

/**
 * React Flow 自定义节点数据
 */
export interface KnowledgeNodeData {
  /** 显示名称（来自 _graph.children[name].name） */
  label: string
  /** 磁盘路径（相对路径） */
  path: string
  /** 父节点 ID（顶层 KB 无 parent） */
  parent?: string
  /** 是否有子节点（决定是否为容器节点） */
  hasChildren: boolean
  /** 域颜色 */
  domainColor?: string
  /** 是否被搜索匹配 */
  searchMatch?: boolean
  /** 是否有未保存的编辑 */
  hasUnsavedEdit?: boolean
  /** 子节点数量（用于徽章显示） */
  childCount?: number
  /** 节点类型：container=容器卡片，leaf=叶子卡片 */
  nodeType: 'container' | 'leaf'
  /** 选中状态 */
  selected?: boolean
  /** 悬停状态 */
  hovered?: boolean
  /** Index signature for React Flow Record<string, unknown> compatibility */
  [key: string]: unknown
}

/** TopoMind 知识卡片节点 */
export type KnowledgeNode = Node<KnowledgeNodeData, 'knowledgeCard'>

/** TopoMind 边 */
export type KnowledgeEdge = Edge<{
  relation: EdgeRelation
  weight: EdgeWeight
  highlighted?: boolean
  faded?: boolean
}>

// ============== 房间/导航 ==============

/** 房间信息 */
export interface Room {
  path: string
  kbPath: string
  name: string
}

/** 房间历史条目 */
export interface RoomHistoryItem {
  room: Room
  savedZoom?: number
  savedPan?: { x: number; y: number }
}

// ============== 应用状态 ==============

/** 连线模式状态 */
export interface EdgeModeState {
  active: boolean
  sourceId: string | null
}

// ============== IPC 响应类型 ==============

/** 目录信息 */
export interface DirInfo {
  path: string
  name: string
  isDir: boolean
}

/** KB 列表项 */
export interface KBListItem {
  path: string
  name: string
  order: number
  coverPath?: string
  childCount?: number
}
