import { create } from 'zustand'
import type { KnowledgeEdge, KnowledgeNode } from '../types'

interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  
  // Derived O(1) maps, automatically kept in sync
  nodesMap: Map<string, KnowledgeNode>
  edgesMap: Map<string, KnowledgeEdge>

  setGraph: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setNodes: (nodes: KnowledgeNode[]) => void
  setEdges: (edges: KnowledgeEdge[]) => void
  setLoading: (loading: boolean) => void

  updateNode: (nodeId: string, updater: (node: KnowledgeNode) => KnowledgeNode) => void
  removeNodes: (nodeIds: string[]) => void
  removeEdgesByNodeIds: (nodeIds: string[]) => void
}

function buildMaps(nodes: KnowledgeNode[], edges: KnowledgeEdge[]) {
  const nodesMap = new Map<string, KnowledgeNode>()
  const edgesMap = new Map<string, KnowledgeEdge>()
  nodes.forEach((n) => nodesMap.set(n.id, n))
  edges.forEach((e) => edgesMap.set(e.id, e))
  return { nodesMap, edgesMap }
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  loading: false,
  nodesMap: new Map(),
  edgesMap: new Map(),

  setGraph: (nodes, edges) => set({
    nodes,
    edges,
    ...buildMaps(nodes, edges),
  }),

  setNodes: (nodes) => set((state) => ({
    nodes,
    ...buildMaps(nodes, state.edges),
  })),

  setEdges: (edges) => set((state) => ({
    edges,
    ...buildMaps(state.nodes, edges),
  })),

  setLoading: (loading) => set({ loading }),

  updateNode: (nodeId, updater) => set((state) => {
    const node = state.nodesMap.get(nodeId)
    if (!node) return state
    const nextNode = updater(node)
    const nextNodes = state.nodes.map(n => n.id === nodeId ? nextNode : n)
    return {
      nodes: nextNodes,
      ...buildMaps(nextNodes, state.edges)
    }
  }),

  removeNodes: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextNodes = state.nodes.filter(n => !removedSet.has(n.id))
    return {
      nodes: nextNodes,
      ...buildMaps(nextNodes, state.edges)
    }
  }),

  removeEdgesByNodeIds: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextEdges = state.edges.filter(e => !removedSet.has(e.source) && !removedSet.has(e.target))
    return {
      edges: nextEdges,
      ...buildMaps(state.nodes, nextEdges)
    }
  }),
}))
