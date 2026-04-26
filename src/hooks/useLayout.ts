/**
 * useLayout — ELK.js layout integration for React Flow nodes
 *
 * Converts React Flow nodes → ELK graph → computed positions → updated nodes
 */
import { useCallback } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node } from '@xyflow/react'
import type { ELKGraph, ELKLayoutResult } from '../types/elk.d'
import { LAYOUT } from '../types'
import { logger } from '../core/logger'
import { logAction } from '../core/log-backend'

// Module-level ELK instance (singleton — shared across all callers)
const elk = new ELK()

/**
 * Core layout computation — a pure async function for testability.
 * Accepts an ELK instance so tests can inject a mock.
 *
 * @param elkInstance - ELK instance with a `.layout()` method
 * @param nodes - React Flow nodes to layout
 * @param direction - 'RIGHT' for global view, 'DOWN' for room view
 * @returns Map of node id → { x, y } position
 */
export async function computeLayoutImpl(
  elkInstance: { layout: (graph: ELKGraph, options?: Record<string, unknown>) => Promise<ELKLayoutResult> },
  nodes: Node[],
  direction: 'RIGHT' | 'DOWN' = 'DOWN'
): Promise<Record<string, { x: number; y: number }>> {
  if (nodes.length === 0) return {}

  const nodeCount = nodes.length
  const spacing = Math.max(LAYOUT.MIN_SPACING, LAYOUT.BASE_SPACING - nodeCount * 2)

  const elkNodes: ELKNode[] = nodes.map((n) => ({
    id: n.id,
    width: (n.measured?.width ?? n.width ?? 180) as number,
    height: (n.measured?.height ?? n.height ?? 80) as number,
    layoutOptions: {
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': '(50, 30)',
    } as unknown as ELKLayoutOptions,
  }))

  const elkEdges: ELKEdge[] = nodes
    .filter((n) => n.data?.parent)
    .map((n) => ({
      id: `e-${n.data!.parent}-${n.id}`,
      sources: [n.data!.parent as string],
      targets: [n.id],
    }))

  const layoutOptions: ELKLayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': spacing,
    'elk.layered.spacing.nodeNodeBetweenLayers': spacing,
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.padding': '[top=30, left=30, bottom=30, right=30]',
  }

  try {
    logAction('布局:开始', 'useLayout', { direction, nodeCount: elkNodes.length, spacing })
    const result: ELKLayoutResult = await elkInstance.layout(
      {
        id: 'root',
        layoutOptions,
        children: elkNodes,
        edges: elkEdges,
      } as ELKGraph,
      {
        layoutOptions: {
          ...layoutOptions,
          'elk.layered.compaction.postCompaction.strategy': 'LEFTWARD',
        },
      }
    )

    const positions: Record<string, { x: number; y: number }> = {}

    if (result.children) {
      for (const child of result.children) {
        if (child.x !== undefined && child.y !== undefined) {
          positions[child.id] = {
            x: child.x,
            y: child.y,
          }
        }
      }
    }

    logAction('布局:完成', 'useLayout', { direction, positionedCount: Object.keys(positions).length })
    return positions
  } catch (e) {
    logger.catch('useLayout', 'ELK layout failed', e)
    logAction('布局:失败', 'useLayout', { direction, nodeCount: elkNodes.length, error: (e as Error)?.message || String(e) })
    return {}
  }
}

interface ELKNode {
  id: string
  width?: number
  height?: number
  layoutOptions?: Record<string, string | number>
}

interface ELKEdge {
  id: string
  sources: string[]
  targets: string[]
}

interface ELKLayoutOptions {
  'elk.algorithm': string
  'elk.direction': 'RIGHT' | 'DOWN'
  'elk.spacing.nodeNode': number
  'elk.layered.spacing.nodeNodeBetweenLayers': number
  'elk.layered.crossingMinimization.strategy': string
  'elk.padding': string
  [key: string]: string | number
}

/**
 * Compute layout for a set of React Flow nodes using ELK.
 *
 * @param nodes - React Flow nodes to layout
 * @param direction - 'RIGHT' for global view (left→right), 'DOWN' for room view (top→down)
 * @returns - Map of node id → { x, y } position
 */
export function useLayout() {
  const computeLayout = useCallback(
    (nodes: Node[], direction: 'RIGHT' | 'DOWN' = 'DOWN') =>
      computeLayoutImpl(elk, nodes, direction),
    []
  )

  return { computeLayout }
}
