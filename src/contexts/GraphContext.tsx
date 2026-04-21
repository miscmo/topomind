/**
 * GraphContext — Single source of truth for graph state
 *
 * All components that need graph state MUST use this context
 * instead of calling useGraph() directly. Calling useGraph()
 * multiple times creates independent React state instances,
 * causing fragmented and inconsistent graph state.
 */
import { createContext, useContext, useMemo, type Context } from 'react'
import { useGraph } from '../hooks/useGraph'
import type { KnowledgeNode, KnowledgeEdge, KnowledgeNodeData } from '../types'
import type { Node, NodeChange, EdgeChange, Connection } from '@xyflow/react'

export interface GraphContextValue {
  // State
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
  isModified: boolean

  // Room lifecycle
  loadRoom: (dirPath: string) => Promise<void>
  navigateBack: () => Promise<void>
  navigateToRoom: (index: number) => Promise<void>

  // React Flow handlers — typed with proper Node<KnowledgeNodeData> signatures
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  onNodeClick: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void
  onPaneClick: (event: React.MouseEvent) => void
  onNodeDoubleClick: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void
  onNodeContextMenu: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void

  // Node operations
  createChildNode: (name: string, parentId?: string) => Promise<string | null>
  deleteChildNode: (nodeId: string) => Promise<boolean>
  renameNode: (nodeId: string, newName: string) => Promise<boolean>

  // Edge operations
  updateEdgeRelation: (edgeId: string, relation: string, weight: string) => void

  // Layout
  layoutNodes: (direction?: 'RIGHT' | 'DOWN') => Promise<void>

  // Search
  highlightSearch: (query: string) => void
}

// Empty context value for when used outside provider
const emptyContext: GraphContextValue = {
  nodes: [],
  edges: [],
  loading: false,
  selectedNode: null,
  isModified: false,
  loadRoom: async () => {},
  navigateBack: async () => {},
  navigateToRoom: async () => {},
  onNodesChange: () => {},
  onEdgesChange: () => {},
  onConnect: () => {},
  onNodeClick: () => {},
  onPaneClick: () => {},
  onNodeDoubleClick: () => {},
  onNodeContextMenu: () => {},
  createChildNode: async () => null as string | null,
  deleteChildNode: async () => false,
  renameNode: async () => false,
  updateEdgeRelation: () => {},
  layoutNodes: async () => {},
  highlightSearch: () => {},
}

// Create context with null default — must be provided by GraphPage
const GraphContext: Context<GraphContextValue> = createContext<GraphContextValue>(emptyContext)

export function GraphContextProvider({ graph, children }: { graph: ReturnType<typeof useGraph>; children: React.ReactNode }) {
  // Single useGraph instance from GraphPage — shared across all components via context
  const value = useMemo<GraphContextValue>(() => ({
    nodes: graph.nodes,
    edges: graph.edges,
    loading: graph.loading,
    selectedNode: graph.selectedNode,
    isModified: graph.isModified,
    loadRoom: graph.loadRoom,
    navigateBack: graph.navigateBack,
    navigateToRoom: graph.navigateToRoom,
    onNodesChange: graph.onNodesChange,
    onEdgesChange: graph.onEdgesChange,
    onConnect: graph.onConnect,
    onNodeClick: graph.onNodeClick as GraphContextValue['onNodeClick'],
    onPaneClick: graph.onPaneClick,
    onNodeDoubleClick: graph.onNodeDoubleClick as GraphContextValue['onNodeDoubleClick'],
    onNodeContextMenu: graph.onNodeContextMenu as GraphContextValue['onNodeContextMenu'],
    createChildNode: graph.createChildNode,
    deleteChildNode: graph.deleteChildNode,
    renameNode: graph.renameNode,
    updateEdgeRelation: graph.updateEdgeRelation as (edgeId: string, relation: string, weight: string) => void,
    layoutNodes: graph.layoutNodes,
    highlightSearch: graph.highlightSearch,
  }), [graph])

  return (
    <GraphContext.Provider value={value}>
      {children}
    </GraphContext.Provider>
  )
}

/** Hook to consume shared graph state — use instead of useGraph() */
export function useGraphContext(): GraphContextValue {
  return useContext(GraphContext)
}
