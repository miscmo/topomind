/**
 * graphBuilder — Node/edge building utilities extracted from useGraph
 *
 * Responsibilities:
 * - Build React Flow nodes from graph metadata (with parallel child count reads)
 * - Build React Flow edges from graph metadata
 * - Serialize nodes+edges to _graph.json format
 */
import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import type { GraphMeta } from '../../core/storage'
import { basenameRef, resolveRoomChildRef } from '../../domain/graph/path-utils'
import { graphMetaToRoomGraph, roomGraphToGraphMeta } from '../../domain/graph/graphMapper'
import type { RoomGraph, RoomGraphEdge, RoomGraphNode } from '../../domain/graph/model'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'
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
  weight: string
  lineMode?: 'smoothstep' | 'straight'
  lineStyle?: 'solid' | 'dashed'
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
    }
  }
  const roomEdges: RoomGraphEdge[] = edges.map((e) => ({
    id: e.id,
    sourceRef: e.source,
    targetRef: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
    lineMode: e.data?.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode,
    lineStyle: e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle,
    color: e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color,
    arrow: e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow,
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

/** Build React Flow nodes from graph metadata and preloaded child-room summaries. */
export function buildNodes(
  dirPath: string,
  meta: GraphMeta,
  summaries: Record<string, BuildNodeSummary>,
  kbPath: string
): KnowledgeNode[] {
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
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
      type: 'knowledgeCard',
      position,
      width: isExpanded ? (roomNode.expandedWidth ?? roomNode.size?.width) : roomNode.size?.width,
      height: isExpanded ? (roomNode.expandedHeight ?? roomNode.size?.height) : roomNode.size?.height,
      data: {
        label: roomNode.name || basenameRef(childPath),
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
      },
    }
  })
}

/** Build React Flow edges from graph metadata */
export function buildEdges(meta: GraphMeta, dirPath = ''): KnowledgeEdge[] {
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
  return roomGraph.edges.map((e) => {
    const lineMode = e.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
    const lineStyle = e.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
    const color = e.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
    const arrow = e.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow

    return {
      id: e.id,
      source: e.sourceRef,
      target: e.targetRef,
      ...buildEdgeView({ lineMode, lineStyle, color, arrow, weight: e.weight }),
      data: {
        relation: e.relation,
        weight: e.weight,
        lineMode,
        lineStyle,
        color,
        arrow,
        highlighted: e.highlighted ?? false,
        faded: e.faded ?? false,
      },
    }
  })
}
