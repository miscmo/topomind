/**
 * graphBuilder — Node/edge building utilities extracted from useGraph
 *
 * Responsibilities:
 * - Build React Flow nodes from graph metadata (with parallel child count reads)
 * - Build React Flow edges from graph metadata
 * - Serialize nodes+edges to _graph.json format
 */
import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import { DOMAIN_COLORS } from '../../types'
import type { GraphMeta } from '../../core/storage'
import { basenameRef, resolveRoomChildRef } from '../../domain/graph/path-utils'
import { graphMetaToRoomGraph, roomGraphToGraphMeta } from '../../domain/graph/graphMapper'
import type { RoomGraph, RoomGraphEdge, RoomGraphNode } from '../../domain/graph/model'
import { buildEdgeView } from './edgeView'

const AUTO_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateId(prefix: string): string {
  let id = prefix
  for (let i = 0; i < 6; i++) {
    id += AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)]
  }
  return id
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

export interface BuildNodesStorage {
  countChildren: (cardPath: string) => Promise<number>
}

/** Convert nodes+edges to adapter GraphMeta format */
export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  viewport?: { zoom: number; pan: { x: number; y: number } } | null
): GraphMeta {
  const roomNodes: RoomGraph['nodes'] = {}
  for (const node of nodes) {
    roomNodes[node.id] = {
      id: node.id,
      cardRef: node.id,
      name: node.data.label,
      position: node.position,
      size: { width: 200, height: 150 },
    }
  }
  const roomEdges: RoomGraphEdge[] = edges.map((e) => ({
    id: e.id,
    sourceRef: e.source,
    targetRef: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
    lineMode: e.data?.lineMode ?? 'smoothstep',
    lineStyle: e.data?.lineStyle ?? 'solid',
    color: e.data?.color ?? '#7f8c8d',
    arrow: e.data?.arrow ?? true,
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
 * Build React Flow nodes from graph metadata.
 * Uses Promise.all for parallel child count reads — eliminates N sequential fs operations.
 */
export async function buildNodes(
  storage: BuildNodesStorage,
  dirPath: string,
  meta: GraphMeta,
  savedPositions: Record<string, { x: number; y: number }>,
  kbPath: string
): Promise<KnowledgeNode[]> {
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
  const normalizedChildren = Object.values(roomGraph.nodes).map((roomNode) => {
    const childPath = resolveRoomChildRef(dirPath, roomNode.cardRef || roomNode.id)
    return [childPath, roomNode] as [string, RoomGraphNode]
  })

  const nodeCount = normalizedChildren.length

  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)

  // Parallelize child count checks
  const childCountResults = await Promise.all(
    normalizedChildren.map(async ([childPath]) => {
      try {
        return await storage.countChildren(childPath)
      } catch {
        return 0
      }
    })
  )

  return normalizedChildren.map(([childPath, roomNode], i) => {
    const nodeId = childPath
    const childCount = childCountResults[i]
    const hasChildren = childCount > 0
    const domainColor = DOMAIN_COLORS[i % DOMAIN_COLORS.length]
    const saved = savedPositions[nodeId]
    const position = roomNode.position ?? saved ?? {
      x: 50 + i * spacingX,
      y: 50 + i * spacingY,
    }

    return {
      id: nodeId,
      type: 'knowledgeCard',
      position,
      data: {
        label: roomNode.name || basenameRef(childPath),
        path: childPath,
        parent: dirPath || kbPath || undefined,
        hasChildren,
        domainColor,
        childCount: hasChildren ? childCount : undefined,
      },
    }
  })
}

/** Build React Flow edges from graph metadata */
export function buildEdges(meta: GraphMeta, dirPath = ''): KnowledgeEdge[] {
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
  return roomGraph.edges.map((e) => {
    const lineMode = e.lineMode ?? 'smoothstep'
    const lineStyle = e.lineStyle ?? 'solid'
    const color = e.color ?? '#7f8c8d'
    const arrow = e.arrow ?? true

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
