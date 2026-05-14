import { createStore, useStore, type StoreApi } from 'zustand'
import { createContext, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../types'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  viewport: { x: number; y: number; zoom: number }
  
  // Derived O(1) maps, automatically kept in sync
  nodesMap: Map<string, KnowledgeNode>
  edgesMap: Map<string, KnowledgeEdge>

  setGraph: (nodes: KnowledgeNode[], edges: KnowledgeEdge[], viewport?: { x: number; y: number; zoom: number }) => void
  setNodes: (nodes: KnowledgeNode[]) => void
  setEdges: (edges: KnowledgeEdge[]) => void
  setLoading: (loading: boolean) => void
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void

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

export const createGraphStore = () => createStore<GraphState>((set) => ({
  nodes: [],
  edges: [],
  loading: false,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodesMap: new Map(),
  edgesMap: new Map(),

  setGraph: (nodes, edges, viewport) => set((state) => ({
    nodes,
    edges,
    viewport: viewport ?? state.viewport,
    ...buildMaps(nodes, edges),
  })),

  setNodes: (nodes) => set((state) => ({
    nodes,
    ...buildMaps(nodes, state.edges),
  })),

  setEdges: (edges) => set((state) => ({
    edges,
    ...buildMaps(state.nodes, edges),
  })),

  setLoading: (loading) => set({ loading }),
  setViewport: (viewport) => set({ viewport }),

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

export const GraphStoreContext = createContext<StoreApi<GraphState> | null>(null)

export function GraphStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<GraphState> | null>(null)
  if (!storeRef.current) {
    storeRef.current = createGraphStore()
  }
  return <GraphStoreContext.Provider value={storeRef.current}>{children}</GraphStoreContext.Provider>
}

export function useGraphStoreApi() {
  const store = useContext(GraphStoreContext)
  if (!store) throw new Error('Missing GraphStoreProvider')
  return store
}

export function useGraphStore<T>(selector: (state: GraphState) => T): T {
  const store = useGraphStoreApi()
  return useStore(store, selector)
}

export function useSelectedNodeId() {
  return useGraphStore((s) => s.nodes.find((n) => n.selected)?.id ?? null)
}

export function useSelectedNode() {
  return useGraphStore((s) => s.nodes.find((n) => n.selected) ?? null)
}
