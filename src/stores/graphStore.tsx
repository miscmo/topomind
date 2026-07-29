import { createStore, useStore, type StoreApi } from 'zustand'
import { temporal } from 'zundo'
import { createContext, useContext, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../types'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  viewport: { x: number; y: number; zoom: number }
  selectedNodeCount: number
  selectedNodeId: string | null
  selectedNodeIds: string[]
  selectedNodes: KnowledgeNode[]
  
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

function getSelectionState(nodes: KnowledgeNode[], previousState?: Pick<GraphState, 'selectedNodeIds' | 'selectedNodes'>) {
  let selectedNodeCount = 0
  let selectedNodeId: string | null = null
  const nextSelectedNodeIds: string[] = []
  const nextSelectedNodes: KnowledgeNode[] = []
  for (const node of nodes) {
    if (!node.selected) continue
    selectedNodeCount += 1
    if (selectedNodeId === null) {
      selectedNodeId = node.id
    }
    nextSelectedNodeIds.push(node.id)
    nextSelectedNodes.push(node)
  }

  const canReuseSelectedNodes =
    previousState !== undefined
    && previousState.selectedNodes.length === nextSelectedNodes.length
    && previousState.selectedNodes.every((node, index) => node === nextSelectedNodes[index])
  const canReuseSelectedNodeIds =
    previousState !== undefined
    && previousState.selectedNodeIds.length === nextSelectedNodeIds.length
    && previousState.selectedNodeIds.every((id, index) => id === nextSelectedNodeIds[index])

  return {
    selectedNodeCount,
    selectedNodeId,
    selectedNodeIds: canReuseSelectedNodeIds ? previousState.selectedNodeIds : nextSelectedNodeIds,
    selectedNodes: canReuseSelectedNodes ? previousState.selectedNodes : nextSelectedNodes,
  }
}

function buildDerivedGraphState(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  previousState?: Pick<GraphState, 'selectedNodeIds' | 'selectedNodes'>
) {
  return {
    nodesMap: buildNodesMap(nodes),
    edgesMap: buildEdgesMap(edges),
    ...getSelectionState(nodes, previousState),
  }
}

function areNodesEqual(nodeA: KnowledgeNode, nodeB: KnowledgeNode) {
  return (
    nodeA === nodeB
    || (
      nodeA.id === nodeB.id
      && nodeA.type === nodeB.type
      && nodeA.position?.x === nodeB.position?.x
      && nodeA.position?.y === nodeB.position?.y
      && nodeA.width === nodeB.width
      && nodeA.height === nodeB.height
      && nodeA.selected === nodeB.selected
      && nodeA.data === nodeB.data
    )
  )
}

function areEdgesEqual(edgeA: KnowledgeEdge, edgeB: KnowledgeEdge) {
  return (
    edgeA === edgeB
    || (
      edgeA.id === edgeB.id
      && edgeA.type === edgeB.type
      && edgeA.source === edgeB.source
      && edgeA.target === edgeB.target
      && edgeA.selected === edgeB.selected
      && edgeA.data === edgeB.data
    )
  )
}

export const createGraphStore = () => createStore<GraphState>()(temporal((set) => ({
  nodes: [],
  edges: [],
  loading: false,
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeCount: 0,
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedNodes: [],
  nodesMap: new Map(),
  edgesMap: new Map(),

  setGraph: (nodes, edges, viewport) => set((state) => ({
    nodes,
    edges,
    viewport: viewport ?? state.viewport,
    ...buildDerivedGraphState(nodes, edges, state),
  })),

  setNodes: (nodes) => set((state) => ({
    nodes,
    nodesMap: buildNodesMap(nodes),
    ...getSelectionState(nodes, state),
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
    const selectionState = getSelectionState(nextNodes, state)
    return {
      nodes: nextNodes,
      nodesMap: nextNodesMap,
      ...selectionState,
    }
  }),

  removeNodes: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextNodes = state.nodes.filter(n => !removedSet.has(n.id))
    const selectionState = getSelectionState(nextNodes, state)
    return {
      nodes: nextNodes,
      nodesMap: buildNodesMap(nextNodes),
      ...selectionState,
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
  limit: 20, // Keep max 20 history steps to reduce memory usage
  onSave: (pastState, currentState) => {
    // Optional: hook for when a state is saved to history
  },
  equality: (a, b) => {
    // Only add to history if actual data changes, ignore selection state changes
    if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
    
    // Reference and key-field comparison keeps history checks off the JSON.stringify hot path.
    for (let i = 0; i < a.nodes.length; i++) {
      const nodeA = a.nodes[i];
      const nodeB = b.nodes[i];
      if (!areNodesEqual(nodeA, nodeB)) return false;
    }

    for (let i = 0; i < a.edges.length; i++) {
      const edgeA = a.edges[i];
      const edgeB = b.edges[i];
      if (!areEdgesEqual(edgeA, edgeB)) return false;
    }
    
    return true;
  }
}))

// Auto-sync maps when temporal state changes
export const setupTemporalMapSync = (store: StoreApi<GraphState>) => {
  return store.subscribe((state, prevState) => {
    if (state.nodes === prevState.nodes && state.edges === prevState.edges) {
      return
    }
    store.setState({
      ...buildDerivedGraphState(state.nodes, state.edges, state),
    })
  })
}

export const GraphStoreContext = createContext<StoreApi<GraphState> | null>(null)

export function GraphStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<GraphState> | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  if (!storeRef.current) {
    storeRef.current = createGraphStore()
    unsubscribeRef.current = setupTemporalMapSync(storeRef.current)
  }

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

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
  return useGraphStore((s) => s.selectedNodeId)
}

