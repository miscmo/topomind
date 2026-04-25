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

/** Convert nodes+edges to _graph.json compatible format */
export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  zoom?: number | null,
  pan?: { x: number; y: number } | null
): {
  children: Record<string, { name: string; x?: number; y?: number }>
  edges: SerializedEdge[]
  zoom?: number | null
  pan?: { x: number; y: number } | null
} {
  const children: Record<string, { name: string; x?: number; y?: number }> = {}
  for (const node of nodes) {
    const childName = node.id.includes('/') ? (node.id.split('/').pop() ?? node.id) : node.id
    children[childName] = {
      name: node.data.label,
      x: node.position?.x,
      y: node.position?.y,
    }
  }
  const graphEdges: SerializedEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
    lineMode: e.data?.lineMode ?? 'smoothstep',
    lineStyle: e.data?.lineStyle ?? 'solid',
    color: e.data?.color ?? '#7f8c8d',
    arrow: e.data?.arrow ?? true,
    // Preserve visual state across save+reload round-trips.
    // Without these, highlighted/faded are silently dropped and never
    // recovered after a layout change or node move triggers a flush.
    highlighted: e.data?.highlighted,
    faded: e.data?.faded,
  }))
  return { children, edges: graphEdges, zoom, pan }
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
  const normalizedChildren = children.map(([rawChildName, childInfo]) => {
    const normalizedName = rawChildName.includes('/') || rawChildName.includes('\\')
      ? (rawChildName.split(/[/\\]/).pop() ?? rawChildName)
      : rawChildName
    return [normalizedName, childInfo] as [string, { name: string }]
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

  return normalizedChildren.map(([childName, childInfo]: [string, { name: string }], i) => {
    const childPath = dirPath ? `${dirPath}/${childName}` : childName
    const nodeId = childPath
    const childCount = childCountResults[i]
    const hasChildren = childCount > 0
    const domainColor = DOMAIN_COLORS[i % DOMAIN_COLORS.length]
    const childSavedPosition = childInfo && typeof childInfo === 'object'
      ? {
          x: typeof childInfo.x === 'number' ? childInfo.x : undefined,
          y: typeof childInfo.y === 'number' ? childInfo.y : undefined,
        }
      : null
    const saved = savedPositions[nodeId]
    const position = saved ?? (
      childSavedPosition?.x != null && childSavedPosition?.y != null
        ? { x: childSavedPosition.x, y: childSavedPosition.y }
        : {
            x: 50 + i * spacingX,
            y: 50 + i * spacingY,
          }
    )

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
      // Restore persisted visual state rather than always defaulting to false.
      // When nodes move or layout changes, the save flushes current state to disk.
      // Without reading it back here, highlighted/faded are permanently lost after reload.
      highlighted: e.highlighted ?? false,
      faded: e.faded ?? false,
    },
  }))
}