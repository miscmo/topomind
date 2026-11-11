/**
 * TopoMind Domain Types
 * Pure domain model types — no UI constants here.
 * See constants.ts for visual/design constants.
 */
import type { Node, Edge } from '@xyflow/react'
import type { EdgeAnchor } from '../domain/graph/edgeAnchors'
import type { CurveControl } from '../domain/graph/edgeCurve'
import type { LinkedDocumentRef } from '../domain/graph/linkedDocuments'

// ============== 视图状态 ==============

/** 应用视图类型 */
export type AppView = 'setup' | 'workspace'

// ============== 图谱元数据 ==============

/**
 * 节点种类（P1 schema 预留）。
 * 'knowledge' = 知识卡片（可下钻成房间、可挂文档）；'shape' = 纯画布图形节点
 * （流程图等，永不物化目录、永不下钻）。缺省一律按 'knowledge' 处理，旧档零迁移。
 * 本轮只做持久化往返，不注册新的 React Flow nodeTypes；新增形状节点时无需再改格式白名单。
 */
export type GraphNodeKind = 'knowledge' | 'shape'

/**
 * _graph.json 中的 children 条目
 * key = 目录名（唯一），name = 显示名称（可不同）
 */
export interface GraphChild {
  name: string
  kind?: GraphNodeKind
  x?: number
  y?: number
  width?: number
  height?: number
  widthMode?: NodeSizingMode
  heightMode?: NodeSizingMode
  expanded?: boolean
  style?: KnowledgeNodeStyle
  expandedWidth?: number
  expandedHeight?: number
  emojis?: string[]
  /** 关联到别处已有文档（docId 为主键，cardRef 为定位缓存），最多 8 条 */
  linkedDocuments?: LinkedDocumentRef[]
}

export type NodeSizingMode = 'auto' | 'manual'

/**
 * _graph.json 中的 edges 条目
 */
export type EdgeLineMode = 'smoothstep' | 'straight' | 'curve'
export type EdgeLineStyle = 'solid' | 'dashed'
/** 箭头形状：实心三角 / 空心 V 形 */
export type EdgeArrowShape = 'solid' | 'hollow'
/** 箭头位置：仅终点 / 仅起点 / 两端都有 */
export type EdgeArrowPosition = 'end' | 'start' | 'both'

/** 连线可编辑的样式字段：新建连线与更新连线样式共用 */
export interface EdgeStylePatch {
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  /** 线条粗细（px），主线会在此基础上按比例加粗 */
  lineWidth?: number
  arrow?: boolean
  arrowSize?: number
  arrowShape?: EdgeArrowShape
  arrowPosition?: EdgeArrowPosition
  /** 曲线控制点（归一化 {u,v}）；null/缺省=直线；仅 lineMode='curve' 时生效 */
  curveControl?: CurveControl | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
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
  /** 曲线控制点（归一化 {u,v}）；null/缺省=直线；仅 lineMode='curve' 时生效 */
  curveControl?: CurveControl | null
  /** 起点端锚点（source 节点边框上的归一化位置）；缺省 = 自动边界交点 */
  sourceAnchor?: EdgeAnchor | null
  /** 终点端锚点（target 节点边框上的归一化位置）；缺省 = 自动边界交点 */
  targetAnchor?: EdgeAnchor | null
  /** 高亮状态（搜索/选中连线时置 true） */
  highlighted?: boolean
  /** 淡化状态（其他连线淡化时置 true） */
  faded?: boolean
}

/**
 * _graph.json 完整结构（逻辑视图）
 * P1 起磁盘上可能是 v2 分片：索引只存 version + 非节点顶层字段，
 * children/edges 由 graphMetaService 从 _graph/nodes-*.json、_graph/edges-*.json 组装。
 * 渲染层始终拿到下面这个完整形状，不需要感知 version。
 */
export interface GraphMeta {
  children?: Record<string, GraphChild>
  edges?: GraphEdge[]
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

// ============== 边类型 ==============

/**
 * 连线关系的稳定 id（唯一规则源 domain/graph/edgeRelations.ts）。
 * 【用户决策 2026-11-08】语义收敛为两类并做物理磁盘迁移，落盘恒为这两值：
 *   related     关联（弱，不参与树）
 *   subordinate 从属（强，source=父 → target=子）
 * 旧的中文值 / 四种内置 id / 自定义 rel_* 只在读取侧经
 * LEGACY_EDGE_RELATION_MAP 映射，绝不再落到磁盘上。
 */
export type EdgeRelation = 'related' | 'subordinate'

/** 边权重（决定主线/次线） */
export type EdgeWeight = 'main' | 'minor'

// ============== React Flow 节点/边 ==============

/**
 * React Flow 自定义节点数据
 */
export interface KnowledgeNodeData {
  /** 显示名称（来自 _graph.children[name].name） */
  label: string
  /** 节点种类（P1 schema 预留，缺省 = knowledge） */
  kind?: GraphNodeKind
  /** 父节点 ID（顶层 KB 无 parent） */
  parent?: string
  /** 卡片引用路径 */
  cardRef?: string
  /** 域颜色 */
  domainColor?: string
  /** 子节点数量（用于徽章显示） */
  childCount?: number
  /** 是否存在卡片摘要内容 */
  hasContent?: boolean
  hasDetail?: boolean
  /** 选中状态 */
  selected?: boolean
  /** 节点表情列表 */
  emojis?: string[]
  /** 关联到别处已有文档（语义层标记，不进格式刷） */
  linkedDocuments?: LinkedDocumentRef[]
  /** 上次展开时的宽度 */
  expandedWidth?: number
  /** 上次展开时的高度 */
  expandedHeight?: number
  /** 上次收起时的宽度 */
  collapsedWidth?: number
  /** 上次收起时的高度 */
  collapsedHeight?: number
  /** 当前宽度模式 */
  widthMode?: NodeSizingMode
  /** 当前高度模式 */
  heightMode?: NodeSizingMode
  nodeStyle?: KnowledgeNodeStyle
  /** 外部请求进入标题编辑（创建节点后自动重命名用），由 nodeCrudOperations 写入 */
  titleEditRequested?: boolean
  /** Index signature for React Flow Record<string, unknown> compatibility */
  [key: string]: unknown
}

export interface KnowledgeNodeStyle {
  headerFontSize?: number
  bodyFontSize?: number
  headerColor?: string
  headerBackgroundColor?: string
  headerFontWeight?: 'normal' | 'bold'
  headerFontStyle?: 'normal' | 'italic'
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
}

/** TopoMind 知识卡片节点 */
export type KnowledgeNode = Node<KnowledgeNodeData, 'knowledgeCard'>

/** TopoMind 边 */
export type KnowledgeEdge = Edge<{
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
  /** 起点端 / 终点端锚点（边框位置，只决定出线方向），绑定在本条边上；缺省 = 自动边界交点 */
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  /** 曲线控制点（归一化 {u,v}）；null/缺省=直线；仅 lineMode='curve' 时生效 */
  curveControl?: CurveControl | null
  highlighted?: boolean
  faded?: boolean
  /** 选中状态（运行时状态，不持久化） */
  selected?: boolean
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

// ============== IPC 响应类型 ==============

/** KB 列表项 */
export interface KBListItem {
  name: string
  childCount?: number
}
