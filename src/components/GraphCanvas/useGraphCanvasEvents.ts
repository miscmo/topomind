import { useCallback } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useGraphContext } from '../../contexts/GraphContext'
import type { KnowledgeNode } from '../../types'

interface UseGraphCanvasEventsOptions {
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
}

export function useGraphCanvasEvents({ onEdgeContextMenu }: UseGraphCanvasEventsOptions) {
  const graph = useGraphContext()
  const { showCM } = useContextMenu()

  const handleNodeClick = graph.onNodeClick as (e: React.MouseEvent, node: Node) => void
  const handleNodeDoubleClick = graph.onNodeDoubleClick as (e: React.MouseEvent, node: Node) => void

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    if (!node) return
    graph.onNodeContextMenu(e, node as KnowledgeNode)
    showCM(node.id, e)
  }, [graph, showCM])

  const handleEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (edge) graph.onEdgeClick(e, edge)
  }, [graph])

  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (!edge) return
    onEdgeContextMenu?.(edge.id, e)
    showCM(edge.id, e)
  }, [onEdgeContextMenu, showCM])

  return {
    graph,
    handleNodeClick,
    handleNodeDoubleClick,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
  }
}
