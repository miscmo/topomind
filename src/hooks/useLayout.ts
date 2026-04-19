/**
 * useLayout — ELK.js layout integration for React Flow nodes
 *
 * Converts React Flow nodes → ELK graph → computed positions → updated nodes
 */
import { useCallback } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node } from '@xyflow/react'
import { LAYOUT } from '../types'

const elk = new ELK()

interface ELKNode {
  id: string
  width?: number
  height?: number
  layoutOptions?: Record<string, unknown>
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
  [key: string]: unknown
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
    async (
      nodes: Node[],
      direction: 'RIGHT' | 'DOWN' = 'DOWN'
    ): Promise<Record<string, { x: number; y: number }>> => {
      if (nodes.length === 0) return {}

      const nodeCount = nodes.length
      const spacing = Math.max(LAYOUT.MIN_SPACING, LAYOUT.BASE_SPACING - nodeCount * 2)

      // Build ELK nodes
      const elkNodes: ELKNode[] = nodes.map((n) => ({
        id: n.id,
        width: (n.measured?.width ?? n.width ?? 180) as number,
        height: (n.measured?.height ?? n.height ?? 80) as number,
        layoutOptions: {
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': '(50, 30)',
        },
      }))

      // Build ELK edges (only use existing edges for layout constraints)
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
        const result = await elk.layout(
          {
            id: 'root',
            layoutOptions,
            children: elkNodes,
            edges: elkEdges,
          },
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

        return positions
      } catch (e) {
        console.error('[useLayout] ELK layout failed:', e)
        // Fallback: return empty positions (nodes stay at their current positions)
        return {}
      }
    },
    []
  )

  return { computeLayout }
}
