/**
 * graphBuilder — Node/edge building utilities extracted from useGraph
 *
 * Responsibilities:
 * - Build React Flow nodes from graph metadata (with parallel child count reads)
 * - Build React Flow edges from graph metadata
 * - Serialize nodes+edges to _graph.json format
 */
import type { KnowledgeNode, KnowledgeEdge, GraphMeta } from '../../types'
import { DOMAIN_COLORS } from '../../types'
import type { useStorage } from '../useStorage'

const AUTO_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateId(prefix: string): string {
  let id = prefix
  for (let i = 0; i < 6; i++) {
    id += AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)]
  }
  return id
}

/** Convert nodes+edges to _graph.json compatible format */
export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[]
): {
  children: Record<string, { name: string }>
  edges: Array<{ id: string; source: string; target: string; relation: string; weight: string }>
} {
  const children: Record<string, { name: string }> = {}
  for (const node of nodes) {
    const childName = node.id.includes('/') ? node.id.split('/').pop()! : node.id
    children[childName] = { name: node.data.label }
  }
  const graphEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
  }))
  return { children, edges: graphEdges }
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
  const children = Object.entries(meta.children ?? {})
  const nodeCount = children.length

  const spacingX = Math.max(60, 200 - nodeCount * 5)
  const spacingY = Math.max(50, 120 - nodeCount * 3)

  // Parallelize child count checks
  const childCountResults = await Promise.all(
    children.map(async ([childName]) => {
      const childPath = dirPath ? `${dirPath}/${childName}` : childName
      try {
        return await storage.countChildren(childPath)
      } catch {
        return 0
      }
    })
  )

  return children.map(([childName, childInfo]: [string, { name: string }], i) => {
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
        label: childInfo.name,
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
  return (meta.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: e.weight === 'main',
    data: {
      relation: e.relation,
      weight: e.weight,
      highlighted: false,
      faded: false,
    },
  }))
}