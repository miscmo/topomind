import { createStore, useStore, type StoreApi } from 'zustand'
import { temporal, type TemporalState } from 'zundo'
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
  // References used to distinguish normal setter updates from temporal restore.
  // These are excluded from undo history and only guard the derived-state sync.
  derivedNodesRef: KnowledgeNode[]
  derivedEdgesRef: KnowledgeEdge[]
  historyRevision: number

  replaceGraph: (nodes: KnowledgeNode[], edges: KnowledgeEdge[], viewport?: { x: number; y: number; zoom: number }) => void
  setNodes: (nodes: KnowledgeNode[]) => void
  setNodesPreservingSelection: (nodes: KnowledgeNode[]) => void
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

function reconcileMap<T extends { id: string }>(previousMap: Map<string, T>, entries: T[]) {
  let nextMap: Map<string, T> | null = null
  const seenIds = new Set<string>()

  for (const entry of entries) {
    seenIds.add(entry.id)
    if (previousMap.get(entry.id) !== entry) {
      nextMap ??= new Map(previousMap)
      nextMap.set(entry.id, entry)
    }
  }

  for (const id of previousMap.keys()) {
    if (!seenIds.has(id)) {
      nextMap ??= new Map(previousMap)
      nextMap.delete(id)
    }
  }

  return nextMap ?? previousMap
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

const NODE_RUNTIME_DATA_KEYS = new Set(['selected', 'hovered', 'connectTarget', 'titleEditRequested'])
const EDGE_RUNTIME_DATA_KEYS = new Set(['selected', 'highlighted', 'faded'])

function areBusinessDataEqual(
  dataA: Record<string, unknown> | undefined,
  dataB: Record<string, unknown> | undefined,
  runtimeKeys: Set<string>
) {
  if (dataA === dataB) return true
  const keysA = Object.keys(dataA ?? {}).filter((key) => !runtimeKeys.has(key))
  const keysB = Object.keys(dataB ?? {}).filter((key) => !runtimeKeys.has(key))
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.is(dataA?.[key], dataB?.[key]))
}

function areNodesEqual(nodeA: KnowledgeNode, nodeB: KnowledgeNode) {
  return (
    nodeA.id === nodeB.id
    && nodeA.type === nodeB.type
    && nodeA.position?.x === nodeB.position?.x
    && nodeA.position?.y === nodeB.position?.y
    && nodeA.width === nodeB.width
    && nodeA.height === nodeB.height
    && areBusinessDataEqual(nodeA.data, nodeB.data, NODE_RUNTIME_DATA_KEYS)
  )
}

function areEdgesEqual(edgeA: KnowledgeEdge, edgeB: KnowledgeEdge) {
  return (
    edgeA.id === edgeB.id
    && edgeA.type === edgeB.type
    && edgeA.source === edgeB.source
    && edgeA.target === edgeB.target
    && edgeA.sourceHandle === edgeB.sourceHandle
    && edgeA.targetHandle === edgeB.targetHandle
    && areBusinessDataEqual(edgeA.data, edgeB.data, EDGE_RUNTIME_DATA_KEYS)
  )
}

export interface GraphHistorySnapshot {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  historyRevision: number
}

export type GraphStoreApi = StoreApi<GraphState> & {
  temporal: StoreApi<TemporalState<GraphHistorySnapshot>>
}

function areGraphHistorySnapshotsEqual(a: GraphHistorySnapshot, b: GraphHistorySnapshot) {
  if (a.historyRevision !== b.historyRevision) return false
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    if (!areNodesEqual(a.nodes[i], b.nodes[i])) return false
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    if (!areEdgesEqual(a.edges[i], b.edges[i])) return false
  }
  return true
}

export function captureGraphHistorySnapshot(state: GraphState): GraphHistorySnapshot {
  return {
    nodes: state.nodes,
    edges: state.edges,
    historyRevision: state.historyRevision,
  }
}

export function commitGraphHistorySnapshot(store: GraphStoreApi, pastState: GraphHistorySnapshot) {
  const currentState = captureGraphHistorySnapshot(store.getState())
  if (areGraphHistorySnapshotsEqual(pastState, currentState)) return false

  store.temporal.setState((temporalState) => ({
    pastStates: [...temporalState.pastStates.slice(-19), pastState],
    futureStates: [],
  }))
  return true
}

export function replaceGraphSession(
  store: GraphStoreApi,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  viewport?: { x: number; y: number; zoom: number }
) {
  const temporalState = store.temporal.getState()
  temporalState.pause()
  try {
    store.getState().replaceGraph(nodes, edges, viewport)
    temporalState.clear()
  } finally {
    temporalState.resume()
  }
}

export const createGraphStore = (): GraphStoreApi => createStore<GraphState>()(temporal((set) => ({
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
  derivedNodesRef: [],
  derivedEdgesRef: [],
  historyRevision: 0,

  replaceGraph: (nodes, edges, viewport) => set((state) => ({
    nodes,
    edges,
    viewport: viewport ?? state.viewport,
    ...buildDerivedGraphState(nodes, edges, state),
    derivedNodesRef: nodes,
    derivedEdgesRef: edges,
    historyRevision: state.historyRevision + 1,
  })),

  setNodes: (nodes) => set((state) => ({
    nodes,
    nodesMap: reconcileMap(state.nodesMap, nodes),
    ...getSelectionState(nodes, state),
    derivedNodesRef: nodes,
  })),

  // Position/dimension updates already carry selection state from the current nodes.
  // Avoid rescanning every node just to derive the same selection arrays on the drag hot path.
  setNodesPreservingSelection: (nodes) => set((state) => {
    const nodesMap = reconcileMap(state.nodesMap, nodes)
    const selectedNodes = state.selectedNodeIds
      .map((id) => nodesMap.get(id))
      .filter((node): node is KnowledgeNode => Boolean(node))
    return {
      nodes,
      nodesMap,
      selectedNodes: selectedNodes.length === state.selectedNodes.length ? selectedNodes : state.selectedNodes,
      derivedNodesRef: nodes,
    }
  }),

  setEdges: (edges) => set((state) => ({
    edges,
    edgesMap: reconcileMap(state.edgesMap, edges),
    derivedEdgesRef: edges,
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
      derivedNodesRef: nextNodes,
    }
  }),

  removeNodes: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextNodes = state.nodes.filter(n => !removedSet.has(n.id))
    const selectionState = getSelectionState(nextNodes, state)
    return {
      nodes: nextNodes,
      nodesMap: reconcileMap(state.nodesMap, nextNodes),
      ...selectionState,
      derivedNodesRef: nextNodes,
    }
  }),

  removeEdgesByNodeIds: (nodeIds) => set((state) => {
    const removedSet = new Set(nodeIds)
    const nextEdges = state.edges.filter(e => !removedSet.has(e.source) && !removedSet.has(e.target))
    return {
      edges: nextEdges,
      edgesMap: reconcileMap(state.edgesMap, nextEdges),
      derivedEdgesRef: nextEdges,
    }
  }),
}), {
  partialize: (state) => ({ nodes: state.nodes, edges: state.edges, historyRevision: state.historyRevision }),
  limit: 20, // Keep max 20 history steps to reduce memory usage
  onSave: (_pastState, _currentState) => {
    // Optional: hook for when a state is saved to history
  },
  equality: areGraphHistorySnapshotsEqual
})) as GraphStoreApi

// Temporal undo/redo restores only nodes and edges. Normal setters update the
// derived refs in the same transaction, so this subscription only handles
// temporal restores. Mutate derived fields during the same notification instead
// of calling store.setState again, which would notify every subscriber twice.
export const setupTemporalMapSync = (store: StoreApi<GraphState>) => {
  return store.subscribe((state) => {
    const nodesNeedSync = state.nodes !== state.derivedNodesRef
    const edgesNeedSync = state.edges !== state.derivedEdgesRef
    if (!nodesNeedSync && !edgesNeedSync) return

    if (nodesNeedSync) {
      state.nodesMap = reconcileMap(state.nodesMap, state.nodes)
      Object.assign(state, getSelectionState(state.nodes, state))
      state.derivedNodesRef = state.nodes
    }

    if (edgesNeedSync) {
      state.edgesMap = reconcileMap(state.edgesMap, state.edges)
      state.derivedEdgesRef = state.edges
    }
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

