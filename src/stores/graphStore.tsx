import { createStore, useStore, type StoreApi } from 'zustand'
import { temporal } from 'zundo'
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

function buildNodesMap(nodes: KnowledgeNode[]) {
  const nodesMap = new Map<string, KnowledgeNode>()
  nodes.forEach((n) => nodesMap.set(n.id, n))
  return nodesMap
}

function buildEdgesMap(edges: KnowledgeEdge[]) {
  const edgesMap = new Map<string, KnowledgeEdge>()
  edges.forEach((e) => edgesMap.set(e.id, e))
  return edgesMap
}

export const createGraphStore = () => createStore<GraphState>()(temporal((set) => ({
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
    nodesMap: buildNodesMap(nodes),
    edgesMap: buildEdgesMap(edges),
  })),

  setNodes: (nodes) => set((state) => ({
    nodes,
    nodesMap: buildNodesMap(nodes),
  })),

  setEdges: (edges) => set((state) => ({
    edges,
    edgesMap: buildEdgesMap(edges),
  })),

  setLoading: (loading) => set({ loading }),
  setViewport: (viewport) => set({ viewport }),

  updateNode: (nodeId, updater) => set((state) => {
    const node = state.nodesMap.get(nodeId)
    if (!node) return state
    const nextNode = updater(node)
    
    // Check if node actually changed to avoid unnecessary history states
    if (node === nextNode) return state
    
    const nextNodes = state.nodes.map(n => n.id === nodeId ? nextNode : n)
    const nextNodesMap = new Map(state.nodesMap)
    nextNodesMap.set(nodeId, nextNode)
    return {
      nodes: nextNodes,
      nodesMap: nextNodesMap
    }
  }),

  removeNodes: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextNodes = state.nodes.filter(n => !removedSet.has(n.id))
    return {
      nodes: nextNodes,
      nodesMap: buildNodesMap(nextNodes)
    }
  }),

  removeEdgesByNodeIds: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextEdges = state.edges.filter(e => !removedSet.has(e.source) && !removedSet.has(e.target))
    return {
      edges: nextEdges,
      edgesMap: buildEdgesMap(nextEdges)
    }
  }),
}), { 
  partialize: (state) => ({ nodes: state.nodes, edges: state.edges }), // Only track nodes and edges for undo/redo
  limit: 50, // Keep max 50 history steps
  onSave: (pastState, currentState) => {
    // Optional: hook for when a state is saved to history
  },
  equality: (a, b) => {
    // Only add to history if actual data changes, ignore selection state changes
    if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
    
    // Deep comparison of node data and dimensions
    for (let i = 0; i < a.nodes.length; i++) {
      const nodeA = a.nodes[i];
      const nodeB = b.nodes[i];
      if (nodeA.id !== nodeB.id) return false;
      const widthModeA = nodeA.data?.widthMode ?? 'auto';
      const widthModeB = nodeB.data?.widthMode ?? 'auto';
      if (widthModeA !== 'auto' || widthModeB !== 'auto') {
        if (nodeA.width !== nodeB.width) return false;
      }

      const heightModeA = nodeA.data?.heightMode ?? 'auto';
      const heightModeB = nodeB.data?.heightMode ?? 'auto';
      if (heightModeA !== 'auto' || heightModeB !== 'auto') {
        if (nodeA.height !== nodeB.height) return false;
      }
      if (nodeA.position?.x !== nodeB.position?.x || nodeA.position?.y !== nodeB.position?.y) return false;
      if (JSON.stringify(nodeA.data) !== JSON.stringify(nodeB.data)) return false;
    }

    // Edge comparison
    for (let i = 0; i < a.edges.length; i++) {
      const edgeA = a.edges[i];
      const edgeB = b.edges[i];
      if (edgeA.id !== edgeB.id) return false;
      if (JSON.stringify(edgeA.data) !== JSON.stringify(edgeB.data)) return false;
    }
    
    return true;
  }
}))

// Auto-sync maps when temporal state changes
export const setupTemporalMapSync = (store: StoreApi<GraphState>) => {
  store.subscribe((state, prevState) => {
    // If nodes or edges array reference changed (which happens on undo/redo)
    // We must unconditionally rebuild the maps based on the new array references
    if (state.nodes !== prevState.nodes) {
      store.setState({ nodesMap: buildNodesMap(state.nodes) })
    }
    if (state.edges !== prevState.edges) {
      store.setState({ edgesMap: buildEdgesMap(state.edges) })
    }
  })
}

export const GraphStoreContext = createContext<StoreApi<GraphState> | null>(null)

export function GraphStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<GraphState> | null>(null)
  if (!storeRef.current) {
    storeRef.current = createGraphStore()
    setupTemporalMapSync(storeRef.current)
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

