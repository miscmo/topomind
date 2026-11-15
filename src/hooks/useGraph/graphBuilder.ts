/**
 * graphBuilder — Node/edge building utilities extracted from useGraph
 *
 * Responsibilities:
 * - Build React Flow nodes from graph metadata (with parallel child count reads)
 * - Build React Flow edges from graph metadata
 * - Serialize nodes+edges to _graph.json format
 */
import type { KnowledgeNode, KnowledgeEdge, KnowledgeNodeStyle } from '../../types'
import type { GraphMeta } from '../../core/storage'
import { basenameRef, resolveRoomChildRef } from '../../domain/graph/path-utils'
import { graphMetaToRoomGraph, roomGraphToGraphMeta } from '../../domain/graph/graphMapper'
import { DEFAULT_NODE_SIZE, type RoomGraph, type RoomGraphEdge, type RoomGraphNode } from '../../domain/graph/model'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'
import { normalizeEdgeAnchor } from '../../domain/graph/edgeAnchors'
import { normalizeCurveControl, type CurveControl } from '../../domain/graph/edgeCurve'
import { normalizeLinkedDocuments } from '../../domain/graph/linkedDocuments'
import { normalizeEdgeRelationLabel, readEdgeRelationId } from '../../domain/graph/edgeRelations'
import { normalizeTreeOrder } from '../../domain/graph/treeOrder.ts'
import { buildEdgeView } from './edgeView'

export function generateId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `${prefix}${randomUuid}`

  const randomBytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(randomBytes)
  if (randomBytes.some((byte) => byte !== 0)) {
    return `${prefix}${Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }

  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Return type — includes highlighted/faded so callers can extend it */
export interface SerializedEdge {
  id: string
  source: string
  target: string
  relation: string
  /** 本条连线的自定义关系名；不写则用全局关系定义名 */
  relationLabel?: string
  weight: string
  lineMode?: 'smoothstep' | 'straight' | 'curve'
  lineStyle?: 'solid' | 'dashed'
  curveControl?: CurveControl | null
  color?: string
  arrow?: boolean
  highlighted?: boolean
  faded?: boolean
}

export interface BuildNodeSummary {
  position?: { x: number; y: number }
  childCount: number
  hasDetail: boolean
}

/** Convert nodes+edges to adapter GraphMeta format */
export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  viewport?: { zoom: number; pan: { x: number; y: number } } | null
): GraphMeta {
  const roomNodes: RoomGraph['nodes'] = {}
  for (const node of nodes) {
    const isExpanded = (node.width ?? node.initialWidth ?? node.measured?.width ?? 120) >= 160
      && (node.height ?? node.initialHeight ?? node.measured?.height ?? 52) >= 96
    const collapsedWidth = node.data.collapsedWidth ?? (isExpanded ? 120 : (node.width ?? node.initialWidth ?? node.measured?.width ?? 120))
    const collapsedHeight = node.data.collapsedHeight ?? (isExpanded ? 36 : (node.height ?? node.initialHeight ?? node.measured?.height ?? 52))
    roomNodes[node.id] = {
      id: node.id,
      cardRef: node.id,
      name: node.data.label,
      // P1：kind 随 node.data 一路写进 RoomGraphNode → GraphMeta.nodes → _graph.json。
      kind: node.data.kind,
      position: node.position,
      size: {
        width: collapsedWidth,
        height: collapsedHeight,
      },
      expanded: isExpanded,
      color: node.data.domainColor,
      style: node.data.nodeStyle,
      expandedWidth: node.data.expandedWidth,
      expandedHeight: node.data.expandedHeight,
      emojis: node.data.emojis,
      // 关联文档必须随节点一起写回 _graph.json；只放在 node.data 里会在刷新后丢失。
      linkedDocuments: normalizeLinkedDocuments(node.data.linkedDocuments),
      // 节点树排序同样随节点一起写回；只放在列表状态里会在刷新后丢失。
      treeOrder: normalizeTreeOrder(node.data.treeOrder),
    }
  }
  const roomEdges: RoomGraphEdge[] = edges.map((e) => ({
    id: e.id,
    sourceRef: e.source,
    targetRef: e.target,
    relation: readEdgeRelationId(e.data?.relation),
    relationLabel: normalizeEdgeRelationLabel(e.data?.relationLabel),
    weight: e.data?.weight ?? 'minor',
    lineMode: e.data?.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode,
    lineStyle: e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle,
    curveControl: normalizeCurveControl(e.data?.curveControl) ?? undefined,
    color: e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color,
    lineWidth: e.data?.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth,
    arrow: e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow,
    arrowSize: e.data?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize,
    arrowShape: e.data?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape,
    arrowPosition: e.data?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition,
    sourceAnchor: normalizeEdgeAnchor(e.data?.sourceAnchor),
    targetAnchor: normalizeEdgeAnchor(e.data?.targetAnchor),
    highlighted: e.data?.highlighted ?? false,
    faded: e.data?.faded ?? false,
  }))
  return roomGraphToGraphMeta({
    roomRef: '',
    nodes: roomNodes,
    edges: roomEdges,
    viewport: viewport ?? { zoom: 1, pan: { x: 0, y: 0 } },
  })
}

/**
 * 新建节点的唯一构造入口（纯函数，零 IO）。
 *
 * 复用 buildNodes 的字段契约：乐观插入内存的节点必须与「从磁盘加载出来的节点」
 * data 完全一致，否则后台 buildMetaFromNodesEdges 写盘时会静默丢字段。
 * 只构造一个节点，不读盘、不碰其它节点 —— 这是「点击即出现」的前提。
 */
export function buildCreatedKnowledgeNode(options: {
  roomPath: string
  kbPath: string
  cardId: string
  name: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  editTitle?: boolean
  /** 未显式给坐标时，按房间现有节点数复现 buildNodes 的默认排布。 */
  fallbackIndex?: number
}): KnowledgeNode {
  const { roomPath, kbPath, cardId, name, size, editTitle, fallbackIndex = 0 } = options
  const nodeCount = fallbackIndex + 1
  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)
  const position = options.position ?? {
    x: 50 + fallbackIndex * spacingX,
    y: 50 + fallbackIndex * spacingY,
  }
  const [node] = buildNodes(roomPath, {
    nodes: {
      [cardId]: {
        id: cardId,
        card: { ref: cardId, name },
        width: size?.width ?? DEFAULT_NODE_SIZE.width,
        height: size?.height ?? DEFAULT_NODE_SIZE.height,
        position,
      },
    },
    edges: [],
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  }, {}, kbPath)
  return {
    ...node,
    selected: true,
    data: editTitle ? { ...node.data, titleEditRequested: true } : { ...node.data },
  }
}

/** Build React Flow nodes from graph metadata and preloaded child-room summaries. */
export function buildNodes(
  dirPath: string,
  meta: GraphMeta,
  summaries: Record<string, BuildNodeSummary>,
  kbPath: string,
  // 加载房间时由 roomLoader 复用同一次转换结果，避免 buildNodes / buildEdges
  // 各自全量跑一遍 graphMetaToRoomGraph（每次都同时转 nodes 与 edges）。
  roomGraphOverride?: RoomGraph
): KnowledgeNode[] {
  const roomGraph = roomGraphOverride ?? graphMetaToRoomGraph(dirPath, meta)
  const normalizedChildren = Object.values(roomGraph.nodes).map((roomNode) => {
    const nodeId = roomNode.id || roomNode.cardRef
    const childPath = resolveRoomChildRef(dirPath, roomNode.cardRef || nodeId)
    return [nodeId, childPath, roomNode] as [string, string, RoomGraphNode]
  })

  const nodeCount = normalizedChildren.length

  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)

  return normalizedChildren.map(([nodeId, childPath, roomNode], i) => {
    const summary = summaries[childPath] ?? { childCount: 0, hasDetail: false }
    const { childCount, hasDetail } = summary
    const saved = summary.position
    const isExpanded = roomNode.expanded === true
    const position = roomNode.position ?? saved ?? {
      x: 50 + i * spacingX,
      y: 50 + i * spacingY,
    }

    return {
      id: nodeId,
      // P1 本轮只做 schema 往返，形状节点的 nodeTypes 还未注册，type 仍统一为 knowledgeCard。
      // 后续接流程图节点时只需在这里按 roomNode.kind 映射 type + 在 GraphCanvas 注册 nodeTypes，
      // 不必再改 _graph.json / convert* / normalize* 的格式白名单。
      type: 'knowledgeCard',
      position,
      width: isExpanded ? (roomNode.expandedWidth ?? roomNode.size?.width) : roomNode.size?.width,
      height: isExpanded ? (roomNode.expandedHeight ?? roomNode.size?.height) : roomNode.size?.height,
      data: {
        label: roomNode.name || basenameRef(childPath),
        kind: roomNode.kind,
        parent: dirPath || kbPath || undefined,
        cardRef: roomNode.cardRef || nodeId,
        domainColor: roomNode.color, // Only use explicitly saved color
        childCount,
        hasContent: false,
        hasDetail,
        nodeStyle: roomNode.style,
        expandedWidth: roomNode.expandedWidth,
        expandedHeight: roomNode.expandedHeight,
        collapsedWidth: roomNode.size?.width,
        collapsedHeight: roomNode.size?.height,
        widthMode: roomNode.widthMode,
        heightMode: roomNode.heightMode,
        emojis: roomNode.emojis,
        linkedDocuments: roomNode.linkedDocuments,
        treeOrder: roomNode.treeOrder,
      },
    }
  })
}

/** Build React Flow edges from graph metadata */
/**
 * 批量样式纯函数：一次遍历完成，未变更节点保持原引用；无实质变化返回 null，
 * 让调用方连一次 setNodes 都不发。旧实现在 forEach 里逐个 updateNode，
 * 每个节点都会触发一次「全量 map + new Map + 全量 selection 扫描」的 store 更新，
 * 选中 K 个节点就是 O(K·N)，万级图批量改样式会明显卡顿。
 */
export function applyNodeStylePatch(
  nodes: KnowledgeNode[],
  nodeIds: string[],
  patch: KnowledgeNodeStyle,
): KnowledgeNode[] | null {
  const ids = new Set(nodeIds)
  const patchEntries = Object.entries(patch)
  let changed = false
  const next = nodes.map((node) => {
    if (!ids.has(node.id)) return node
    const current = node.data.nodeStyle ?? {}
    if (!patchEntries.some(([key, value]) => current[key as keyof KnowledgeNodeStyle] !== value)) return node
    changed = true
    return { ...node, data: { ...node.data, nodeStyle: { ...current, ...patch } } }
  })
  return changed ? next : null
}

/** 批量清除自有样式：与 applyNodeStylePatch 同口径，一次 setNodes 即可。 */
export function clearNodeStyles(nodes: KnowledgeNode[], nodeIds: string[]): KnowledgeNode[] | null {
  const ids = new Set(nodeIds)
  let changed = false
  const next = nodes.map((node) => {
    if (!ids.has(node.id) || !node.data.nodeStyle) return node
    changed = true
    const { nodeStyle: _nodeStyle, ...nextData } = node.data
    return { ...node, data: nextData }
  })
  return changed ? next : null
}

/**
 * 左侧节点树拖动排序：一次遍历写完同一父下所有兄弟的 treeOrder，
 * 未变更节点保持引用；无变化返回 null（连一次 setNodes 都不发）。
 * 只改 data.treeOrder，position / 尺寸 / data 其余字段一律不动，画布布局零影响。
 */
export function applyTreeOrderPatch(
  nodes: KnowledgeNode[],
  updates: ReadonlyArray<{ id: string; treeOrder: number }>,
): KnowledgeNode[] | null {
  if (updates.length === 0) return null
  const nextOrder = new Map(updates.map((item) => [item.id, normalizeTreeOrder(item.treeOrder)]))
  let changed = false
  const next = nodes.map((node) => {
    if (!nextOrder.has(node.id)) return node
    const value = nextOrder.get(node.id)
    if (node.data.treeOrder === value) return node
    changed = true
    return { ...node, data: { ...node.data, treeOrder: value } }
  })
  return changed ? next : null
}

export function buildEdges(meta: GraphMeta, dirPath = '', roomGraphOverride?: RoomGraph): KnowledgeEdge[] {
  const roomGraph = roomGraphOverride ?? graphMetaToRoomGraph(dirPath, meta)
  return roomGraph.edges.map((e) => {
    const lineMode = e.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
    const lineStyle = e.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
    const curveControl = normalizeCurveControl(e.curveControl) ?? undefined
    const color = e.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
    const lineWidth = e.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth
    const arrow = e.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
    const arrowSize = e.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize
    const arrowShape = e.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
    const arrowPosition = e.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition

    return {
      id: e.id,
      source: e.sourceRef,
      target: e.targetRef,
      ...buildEdgeView({ lineMode, lineStyle, color, lineWidth, arrow, arrowSize, arrowShape, arrowPosition, weight: e.weight }),
      data: {
        relation: e.relation,
        relationLabel: e.relationLabel,
        weight: e.weight,
        lineMode,
        lineStyle,
        curveControl,
        color,
        lineWidth,
        arrow,
        arrowSize,
        arrowShape,
        arrowPosition,
        sourceAnchor: normalizeEdgeAnchor(e.sourceAnchor),
        targetAnchor: normalizeEdgeAnchor(e.targetAnchor),
        highlighted: e.highlighted ?? false,
        faded: e.faded ?? false,
      },
    }
  })
}
