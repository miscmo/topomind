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
import type { KnowledgeNodeData, KnowledgeNodeStyle, EdgeRelation, EdgeWeight, EdgeLineMode, EdgeLineStyle } from '../types'
import type { Node, Edge, NodeChange, EdgeChange, Connection } from '@xyflow/react'

export interface GraphContextValue {
  // Room lifecycle
  loadRoom: (dirPath: string) => Promise<void>
  navigateBack: () => Promise<void>
  navigateToRoom: (index: number) => Promise<void>
  navigateToRoot: () => Promise<void>

  // React Flow handlers — typed with proper Node<KnowledgeNodeData> signatures
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  onNodeClick: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void
  onPaneClick: () => void
  onConnectStart: (event: unknown, params: { nodeId?: string | null }) => void
  onConnectEnd: () => void
  navigateToChildRoom: (childPath: string, childName: string) => Promise<void>
  onNodeContextMenu: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void

  // Node operations
  createChildNode: (name: string, parentId?: string, position?: { x: number; y: number }, options?: { editTitle?: boolean }) => Promise<string | null>
  deleteChildNode: (nodeId: string) => Promise<boolean>
  renameNode: (nodeId: string, newName: string) => Promise<boolean>
  updateNodeStyle: (nodeId: string, style: KnowledgeNodeStyle) => Promise<void>
  updateNodesStyle: (nodeIds: string[], style: KnowledgeNodeStyle) => Promise<void>
  selectNode: (nodeId: string, multiSelect?: boolean) => void
  deselectNode: () => void

  // Edge operations
  updateEdgeRelation: (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => void
  updateEdgeStyle: (edgeId: string, style: { lineMode?: EdgeLineMode; lineStyle?: EdgeLineStyle; color?: string; arrow?: boolean; selected?: boolean }) => void

  // Persistence
  flushCurrentRoomSave: () => Promise<void>
}

// Empty context value for when used outside provider
const emptyContext: GraphContextValue = {
  loadRoom: async () => {},
  navigateBack: async () => {},
  navigateToRoom: async () => {},
  navigateToRoot: async () => {},
  onNodesChange: () => {},
  onEdgesChange: () => {},
  onConnect: () => {},
  onNodeClick: () => {},
  onEdgeClick: () => {},
  onPaneClick: () => {},
  onConnectStart: () => {},
  onConnectEnd: () => {},
  navigateToChildRoom: async () => {},
  onNodeContextMenu: () => {},
  createChildNode: async () => null as string | null,
  deleteChildNode: async () => false,
  renameNode: async () => false,
  updateNodeStyle: async () => {},
  updateNodesStyle: async () => {},
  selectNode: () => {},
  deselectNode: () => {},
  updateEdgeRelation: () => {},
  updateEdgeStyle: () => {},
  flushCurrentRoomSave: async () => {},
}

// Create context with null default — must be provided by GraphPage
const GraphContext: Context<GraphContextValue> = createContext<GraphContextValue>(emptyContext)

type GraphContextSource = Pick<ReturnType<typeof useGraph>, keyof GraphContextValue>

function createGraphContextValue(graph: GraphContextSource): GraphContextValue {
  return {
    loadRoom: graph.loadRoom,
    navigateBack: graph.navigateBack,
    navigateToRoom: graph.navigateToRoom,
    navigateToRoot: graph.navigateToRoot,
    onNodesChange: graph.onNodesChange,
    onEdgesChange: graph.onEdgesChange,
    onConnect: graph.onConnect,
    onNodeClick: graph.onNodeClick as GraphContextValue['onNodeClick'],
    onEdgeClick: graph.onEdgeClick as GraphContextValue['onEdgeClick'],
    onPaneClick: graph.onPaneClick,
    onConnectStart: graph.onConnectStart,
    onConnectEnd: graph.onConnectEnd,
    navigateToChildRoom: graph.navigateToChildRoom,
    onNodeContextMenu: graph.onNodeContextMenu as GraphContextValue['onNodeContextMenu'],
    createChildNode: graph.createChildNode,
    deleteChildNode: graph.deleteChildNode,
    renameNode: graph.renameNode,
    updateNodeStyle: graph.updateNodeStyle,
    updateNodesStyle: graph.updateNodesStyle,
    selectNode: graph.selectNode,
    deselectNode: graph.deselectNode,
    updateEdgeRelation: graph.updateEdgeRelation,
    updateEdgeStyle: graph.updateEdgeStyle,
    flushCurrentRoomSave: graph.flushCurrentRoomSave,
  }
}

export function GraphContextProvider({ graph, children }: { graph: GraphContextSource; children: React.ReactNode }) {
  const value = useMemo<GraphContextValue>(() => createGraphContextValue(graph), [graph])

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
