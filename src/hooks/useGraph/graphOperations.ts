/**
 * graphOperations — Node/edge CRUD and mutation operations for the graph
 *
 * Extracted from useGraph.ts to keep the hook focused on coordination.
 * All functions here deal with pure state transformations and storage I/O.
 */
import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import type { GraphMeta } from '../../core/storage'
import { buildMetaFromNodesEdges } from './graphBuilder'
import { buildNodeCrudOperations } from './nodeCrudOperations'
import { buildEdgeOperations } from './edgeOperations'
import { buildNodeChangeOperations } from './nodeChangeOperations'
import { buildSelectionOperations } from './selectionOperations'

export interface StorageApi {
  createCard: (parentPath: string, cardName: string) => Promise<string | null>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  flushGraphSave: (dirPath: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => Promise<void>
  readLayout: (dirPath: string) => Promise<GraphMeta>
  writeLayout: (dirPath: string, meta: GraphMeta) => Promise<void>
}

export interface GraphOpsDeps {
  storage: StorageApi
  nodesMapRef: React.MutableRefObject<Map<string, KnowledgeNode>>
  edgesMapRef: React.MutableRefObject<Map<string, KnowledgeEdge>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
  getActiveSelectedNodeId: () => string | null
  setActiveSelectedNodeId: (nodeId: string | null) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
  isCreatingRef: React.MutableRefObject<boolean>
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveGraphSession,
    loadRoom,
    rebuildMaps,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    updateSelectedNode,
    isCreatingRef,
  } = deps

  // ===== Internal helpers =====

  const saveNow = async (dirPath: string) => {
    if (!dirPath) return
    await storage.flushGraphSave(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      undefined
    )
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    getActiveGraphSession,
    loadRoom,
    rebuildMaps,
    saveNow,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    isCreatingRef,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    edgesRef,
    getActiveGraphSession,
    rebuildMaps,
    saveNow,
    setState,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    nodesRef,
    edgesRef,
    getActiveGraphSession,
    getActiveSelectedNodeId,
    rebuildMaps,
    saveNow,
    setState,
    updateSelectedNode,
  })

  // ===== Selection =====

  const selectionOps = buildSelectionOperations({
    nodesMapRef,
    nodesRef,
    setActiveSelectedNodeId,
    updateSelectedNode,
  })

  return {
    // Node CRUD
    ...nodeCrudOps,
    // Edge CRUD
    ...edgeOps,
    // Position changes
    ...nodeChangeOps,
    // Selection
    ...selectionOps,
    // Internal
    saveNow,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>
