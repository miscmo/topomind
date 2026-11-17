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
import type { KnowledgeNodeData, KnowledgeNodeStyle, EdgeRelation, EdgeWeight, EdgeStylePatch, NodeSizingMode } from '../types'
import type { EdgeAnchorPatch } from '../domain/graph/edgeAnchors'
import type { Node, Edge, NodeChange, EdgeChange, Connection, FinalConnectionState } from '@xyflow/react'

export interface GraphContextValue {
  // Room lifecycle
  loadRoom: (dirPath: string) => Promise<void>
  /** 原地刷新会话当前房间（不切房间、不跳相机）；跨房间移动的撤销/前进专用 */
  refreshCurrentRoom: () => Promise<void>
  navigateBack: () => Promise<void>
  navigateToRoom: (index: number) => Promise<void>
  navigateToRoot: () => Promise<void>

  // React Flow handlers — typed with proper Node<KnowledgeNodeData> signatures
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  onNodeClick: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void
  selectEdge: (edgeId: string) => void
  onPaneClick: () => void
  onConnectStart: (event: unknown, params: { nodeId?: string | null }) => void
  onConnectEnd: (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => void
  navigateToChildRoom: (childPath: string, childName: string) => Promise<void>
  onNodeContextMenu: (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => void

  // Node operations
  createChildNode: (name: string, parentId?: string, position?: { x: number; y: number }, options?: { editTitle?: boolean }) => Promise<string | null>
  deleteChildNode: (nodeId: string) => Promise<boolean>
  renameNode: (nodeId: string, newName: string) => Promise<boolean>
  updateNodeStyle: (nodeId: string, style: KnowledgeNodeStyle) => Promise<void>
  updateNodesStyle: (nodeIds: string[], style: KnowledgeNodeStyle) => Promise<void>
  clearNodesStyle: (nodeIds: string[]) => Promise<void>
  updateNodeSizingMode: (nodeId: string, patch: Partial<{ widthMode: NodeSizingMode; heightMode: NodeSizingMode }>) => Promise<void>
  updateNodeEmojis: (nodeId: string, emojis: string[] | undefined) => Promise<void>
  selectNode: (nodeId: string, multiSelect?: boolean) => void
  deselectNode: () => void
  createEdge: (source: string, target: string) => Promise<string | null>
  /** 多选 >=2 个节点时沿选区中轴水平镜像；只读 / 选区不足时返回 false */
  flipSelectionHorizontally: () => Promise<boolean>
  /** 以传入节点（省略则用当前选中）为根选中整棵从属子树；返回 false = 无有效根 */
  selectSubtree: (rootIds?: readonly string[]) => boolean
  /** 左侧节点树拖动排序：只写同父兄弟的 treeOrder，返回 false = 无变化 / 只读 */
  setNodeTreeOrder: (updates: ReadonlyArray<{ id: string; treeOrder: number }>) => Promise<boolean>

  // Edge operations
  /** weight 省略时沿用该边原权重；切换关系会套用关系自带的默认样式 */
  /** 返回 false 表示被从属关系强校验拒绝（唯一父 / 无环 / 深度 ≤100） */
  updateEdgeRelation: (edgeId: string, relation: EdgeRelation, weight?: EdgeWeight) => Promise<boolean>
  /** 双击连线编辑本条边的自定义关系名；传 null / 空白 = 恢复全局关系名 */
  updateEdgeRelationLabel: (edgeId: string, label: string | null) => Promise<boolean>
  updateEdgeStyle: (edgeId: string, style: EdgeStylePatch & { selected?: boolean }) => void
  updateEdgeAnchor: (edgeId: string, patch: EdgeAnchorPatch) => void
  deleteEdge: (edgeId: string) => Promise<boolean>

  // Persistence
  flushCurrentRoomSave: () => Promise<void>
}

// A graph context without its provider is a programming error. Keep the
// default value null so missing providers fail at the consumption boundary.
const GraphContext: Context<GraphContextValue | null> = createContext<GraphContextValue | null>(null)

type GraphContextSource = Pick<ReturnType<typeof useGraph>, keyof GraphContextValue>

function createGraphContextValue(graph: GraphContextSource): GraphContextValue {
  return {
    loadRoom: graph.loadRoom,
    refreshCurrentRoom: graph.refreshCurrentRoom,
    navigateBack: graph.navigateBack,
    navigateToRoom: graph.navigateToRoom,
    navigateToRoot: graph.navigateToRoot,
    onNodesChange: graph.onNodesChange,
    onEdgesChange: graph.onEdgesChange,
    onConnect: graph.onConnect,
    onNodeClick: graph.onNodeClick as GraphContextValue['onNodeClick'],
    onEdgeClick: graph.onEdgeClick as GraphContextValue['onEdgeClick'],
    selectEdge: graph.selectEdge,
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
    clearNodesStyle: graph.clearNodesStyle,
    updateNodeSizingMode: graph.updateNodeSizingMode,
    updateNodeEmojis: graph.updateNodeEmojis,
    selectNode: graph.selectNode,
    deselectNode: graph.deselectNode,
    createEdge: graph.createEdge,
    flipSelectionHorizontally: graph.flipSelectionHorizontally,
    selectSubtree: graph.selectSubtree,
    setNodeTreeOrder: graph.setNodeTreeOrder,
    updateEdgeRelation: graph.updateEdgeRelation,
    updateEdgeRelationLabel: graph.updateEdgeRelationLabel,
    updateEdgeStyle: graph.updateEdgeStyle,
    updateEdgeAnchor: graph.updateEdgeAnchor,
    deleteEdge: graph.deleteEdge,
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
  const graph = useContext(GraphContext)
  if (!graph) {
    throw new Error('useGraphContext must be used within GraphContextProvider')
  }
  return graph
}
