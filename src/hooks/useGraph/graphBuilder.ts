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
import { buildEdgeView } from './edgeView'

const AUTO_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const GRAPH_NODE_IO_CONCURRENCY = 8

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
  return results
}

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
  listTopoDocuments?: (cardPath: string) => Promise<unknown[]>
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
    }
  }
  const roomEdges: RoomGraphEdge[] = edges.map((e) => ({
    id: e.id,
    sourceRef: e.source,
    targetRef: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
    lineMode: e.data?.lineMode ?? 'straight',
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
    const nodeId = roomNode.id || roomNode.cardRef
    const childPath = resolveRoomChildRef(dirPath, roomNode.cardRef || nodeId)
    return [nodeId, childPath, roomNode] as [string, string, RoomGraphNode]
  })

  const nodeCount = normalizedChildren.length

  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)

  const nodeInfoResults = await mapWithConcurrency(
    normalizedChildren,
    GRAPH_NODE_IO_CONCURRENCY,
    async ([, childPath]) => {
      const childCount = await storage.countChildren(childPath).catch(() => 0)
      const hasDetail = storage.listTopoDocuments 
        ? await storage.listTopoDocuments(childPath).then(docs => docs.length > 0).catch(() => false)
        : false
      return { childCount, hasContent: false, hasDetail }
    }
  )

  return normalizedChildren.map(([nodeId, childPath, roomNode], i) => {
    const { childCount, hasContent, hasDetail } = nodeInfoResults[i]
    const saved = savedPositions[nodeId]
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
        domainColor: roomNode.color, // Only use explicitly saved color
        childCount,
        hasContent,
        hasDetail,
        nodeStyle: roomNode.style,
        expandedWidth: roomNode.expandedWidth,
        expandedHeight: roomNode.expandedHeight,
        collapsedWidth: roomNode.size?.width,
        collapsedHeight: roomNode.size?.height,
      },
    }
  })
}

/** Build React Flow edges from graph metadata */
export function buildEdges(meta: GraphMeta, dirPath = ''): KnowledgeEdge[] {
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
  return roomGraph.edges.map((e) => {
    const lineMode = e.lineMode ?? 'straight'
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
