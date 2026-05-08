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
import type { GraphMeta } from '../../core/storage/adapter/graph'
import type { CardInfo } from '../../core/storage/adapter/card'
import type { useStorage } from '../useStorage'

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

/** Convert nodes+edges to adapter GraphMeta format */
export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  viewport?: { zoom: number; pan: { x: number; y: number } } | null
): GraphMeta {
  const metaNodes: Record<string, { id: string; card: CardInfo; height: number; width: number }> = {}
  for (const node of nodes) {
    const rawId = node.id.includes('/') ? (node.id.split('/').pop() ?? node.id) : node.id
    metaNodes[node.id] = {
      id: node.id,
      card: { ref: node.id, name: node.data.label, updatedAt: undefined },
      height: 150,
      width: 200,
    }
  }
  const metaEdges = edges.map((e) => ({
    id: e.id,
    source: { ref: e.source, name: '', updatedAt: undefined } as CardInfo,
    target: { ref: e.target, name: '', updatedAt: undefined } as CardInfo,
    relation: (e.data?.relation ?? '相关') as import('../../core/storage/adapter/graph').KBEdge['relation'],
    weight: (e.data?.weight ?? 'minor') as import('../../core/storage/adapter/graph').KBEdge['weight'],
    lineMode: e.data?.lineMode ?? 'smoothstep',
    lineStyle: e.data?.lineStyle ?? 'solid',
    color: e.data?.color ?? '#7f8c8d',
    arrow: e.data?.arrow ?? true,
    highlighted: e.data?.highlighted ?? false,
    faded: e.data?.faded ?? false,
  }))
  return {
    nodes: metaNodes,
    edges: metaEdges,
    viewport: viewport ?? { zoom: 1, pan: { x: 0, y: 0 } },
  }
}

/**
 * Build React Flow nodes from graph metadata.
 * Uses Promise.all for parallel child count reads — eliminates N sequential fs operations.
 */
export async function buildNodes(
  storage: ReturnType<typeof useStorage>,
  dirPath: string,
  meta: GraphMeta,
  savedPositions: Record<string, { x: number; y: number }>,
  kbPath: string
): Promise<KnowledgeNode[]> {
  const nodeEntries = Object.entries(meta.nodes)
  const normalizedChildren = nodeEntries.map(([nodeId, kbNode]) => {
    const rawChildName = nodeId.includes('/') || nodeId.includes('\\')
      ? (nodeId.split(/[/\\]/).pop() ?? nodeId)
      : nodeId
    return [rawChildName, kbNode] as [string, { card: { name: string }; height: number; width: number }]
  })

  const nodeCount = normalizedChildren.length

  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)

  // Parallelize child count checks
  const childCountResults = await Promise.all(
    normalizedChildren.map(async ([childName]) => {
      const childPath = dirPath ? `${dirPath}/${childName}` : childName
      try {
        return await storage.countChildren(childPath)
      } catch {
        return 0
      }
    })
  )

  return normalizedChildren.map(([childName, kbNode]: [string, { card: { name: string }; height: number; width: number }], i) => {
    const childPath = dirPath ? `${dirPath}/${childName}` : childName
    const nodeId = childPath
    const childCount = childCountResults[i]
    const hasChildren = childCount > 0
    const domainColor = DOMAIN_COLORS[i % DOMAIN_COLORS.length]
    const saved = savedPositions[nodeId]
    const position = saved ?? {
      x: 50 + i * spacingX,
      y: 50 + i * spacingY,
    }

    return {
      id: nodeId,
      type: 'knowledgeCard',
      position,
      data: {
        label: kbNode.card.name,
        path: childPath,
        parent: dirPath || kbPath || undefined,
        hasChildren,
        domainColor,
        childCount: hasChildren ? childCount : undefined,
        nodeType: hasChildren ? 'container' : 'leaf',
      },
    }
  })
}

/** Build React Flow edges from graph metadata */
export function buildEdges(meta: GraphMeta): KnowledgeEdge[] {
  return meta.edges.map((e) => ({
    id: e.id,
    source: e.source.ref,
    target: e.target.ref,
    type: e.lineMode ?? 'smoothstep',
    animated: e.weight === 'main',
    style: {
      stroke: e.color ?? '#7f8c8d',
      strokeWidth: e.weight === 'main' ? 2.5 : 2,
      strokeDasharray: (e.lineStyle ?? 'solid') === 'dashed' ? '6 4' : undefined,
    },
    markerEnd: (e.arrow ?? true)
      ? {
          type: 'arrowclosed',
          color: e.color ?? '#7f8c8d',
        }
      : undefined,
    data: {
      relation: e.relation,
      weight: e.weight,
      lineMode: e.lineMode ?? 'smoothstep',
      lineStyle: e.lineStyle ?? 'solid',
      color: e.color ?? '#7f8c8d',
      arrow: e.arrow ?? true,
      highlighted: e.highlighted ?? false,
      faded: e.faded ?? false,
    },
  }))
}