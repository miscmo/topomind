import { useCallback, useRef } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'

interface UseGraphRefsOptions {
  setSelectedNode: (node: KnowledgeNode | null) => void
}

export function useGraphRefs({ setSelectedNode }: UseGraphRefsOptions) {
  const nodesMapRef = useRef<Map<string, KnowledgeNode>>(new Map())
  const edgesMapRef = useRef<Map<string, KnowledgeEdge>>(new Map())
  const nodesRef = useRef<KnowledgeNode[]>([])
  const edgesRef = useRef<KnowledgeEdge[]>([])

  const rebuildMaps = useCallback((nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
    nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
    edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
  }, [])

  const updateSelectedNode = useCallback((nodes: KnowledgeNode[], nodeId: string | null) => {
    if (!nodeId) {
      setSelectedNode(null)
      return
    }
    const node = nodes.find((n) => n.id === nodeId) ?? null
    setSelectedNode(node)
  }, [setSelectedNode])

  return {
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    rebuildMaps,
    updateSelectedNode,
  }
}
