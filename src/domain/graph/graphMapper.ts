import type { CardInfo, GraphMeta } from './model'
import { basenameRef, normalizeRef } from './path-utils'
import {
  DEFAULT_NODE_SIZE,
  DEFAULT_VIEWPORT,
  type GraphPoint,
  type RoomGraph,
  type RoomGraphEdge,
  type RoomGraphNode,
} from './model'

function isFinitePoint(value: unknown): value is GraphPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<GraphPoint>
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function normalizePoint(value: unknown, fallback: GraphPoint): GraphPoint {
  return isFinitePoint(value) ? { x: value.x, y: value.y } : fallback
}

export function graphMetaToRoomGraph(roomRef: string, meta: GraphMeta): RoomGraph {
  const nodes: Record<string, RoomGraphNode> = {}
  const normalizedRoomRef = normalizeRef(roomRef)

  for (const [nodeKey, node] of Object.entries(meta.nodes ?? {})) {
    const id = normalizeRef(node.id || nodeKey)
    const cardRef = normalizeRef(node.card?.ref || id)
    nodes[id] = {
      id,
      cardRef,
      name: node.card?.name || basenameRef(cardRef) || basenameRef(id),
      position: isFinitePoint(node.position) ? normalizePoint(node.position, { x: 0, y: 0 }) : undefined,
      size: {
        width: Number.isFinite(node.width) ? node.width : DEFAULT_NODE_SIZE.width,
        height: Number.isFinite(node.height) ? node.height : DEFAULT_NODE_SIZE.height,
      },
      widthMode: node.widthMode,
      heightMode: node.heightMode,
      expanded: node.expanded,
      color: node.color,
      style: node.style,
      expandedWidth: node.expandedWidth,
      expandedHeight: node.expandedHeight,
      emojis: node.emojis,
    }
  }

  return {
    roomRef: normalizedRoomRef,
    nodes,
    edges: (meta.edges ?? []).map<RoomGraphEdge>((edge) => ({
      id: edge.id,
      sourceRef: normalizeRef(edge.source.ref),
      targetRef: normalizeRef(edge.target.ref),
      relation: edge.relation,
      weight: edge.weight,
      lineMode: edge.lineMode,
      lineStyle: edge.lineStyle,
      color: edge.color,
      arrow: edge.arrow,
      highlighted: edge.highlighted,
      faded: edge.faded,
    })),
    viewport: {
      zoom: Number.isFinite(meta.viewport?.zoom) ? meta.viewport.zoom : DEFAULT_VIEWPORT.zoom,
      pan: normalizePoint(meta.viewport?.pan, DEFAULT_VIEWPORT.pan),
    },
  }
}

export function roomGraphToGraphMeta(graph: RoomGraph): GraphMeta {
  const nodes: GraphMeta['nodes'] = {}

  for (const node of Object.values(graph.nodes)) {
    nodes[node.id] = {
      id: node.id,
      card: {
        ref: node.cardRef,
        name: node.name,
        updatedAt: undefined,
      } as CardInfo,
      height: node.size?.height ?? DEFAULT_NODE_SIZE.height,
      width: node.size?.width ?? DEFAULT_NODE_SIZE.width,
      widthMode: node.widthMode,
      heightMode: node.heightMode,
      position: node.position,
      expanded: node.expanded,
      color: node.color,
      style: node.style,
      expandedWidth: node.expandedWidth,
      expandedHeight: node.expandedHeight,
      emojis: node.emojis,
    }
  }

  return {
    nodes,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: { ref: edge.sourceRef, name: '', updatedAt: undefined } as CardInfo,
      target: { ref: edge.targetRef, name: '', updatedAt: undefined } as CardInfo,
      relation: edge.relation,
      weight: edge.weight,
      lineMode: edge.lineMode,
      lineStyle: edge.lineStyle,
      color: edge.color,
      arrow: edge.arrow,
      highlighted: edge.highlighted,
      faded: edge.faded,
    })),
    viewport: graph.viewport,
  }
}
