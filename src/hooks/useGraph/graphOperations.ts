/**
 * graphOperations — Node/edge CRUD and mutation operations for the graph
 *
 * Extracted from useGraph.ts to keep the hook focused on coordination.
 * All functions here deal with pure state transformations and storage I/O.
 */
import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import type { GraphMeta } from '../../core/storage/adapter/graph'
import { buildMetaFromNodesEdges } from './graphBuilder'
import { buildNodeCrudOperations } from './nodeCrudOperations'
import { buildEdgeOperations } from './edgeOperations'
import { buildNodeChangeOperations } from './nodeChangeOperations'
import { buildSelectionOperations } from './selectionOperations'

export interface StorageApi {
  createCard: (parentPath: string, cardName: string) => Promise<string | null>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  saveGraphDebounced: (dirPath: string, buildMeta: () => GraphMeta, onFlush: () => void) => Promise<void>
  flushGraphSave: (dirPath: string, buildMeta: () => GraphMeta, onFlush: () => void) => Promise<void>
  readLayout: (dirPath: string) => Promise<GraphMeta>
  writeLayout: (dirPath: string, meta: GraphMeta) => Promise<void>
}

export interface GraphOpsDeps {
  storage: StorageApi
  nodesMapRef: React.MutableRefObject<Map<string, KnowledgeNode>>
  edgesMapRef: React.MutableRefObject<Map<string, KnowledgeEdge>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
  getActiveSelectedNodeId: () => string | null
  setActiveSelectedNodeId: (nodeId: string | null) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
  setDirtyState: (next: boolean) => void
  isCreatingRef: React.MutableRefObject<boolean>
  isModifiedRef: React.MutableRefObject<boolean>
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveNavState,
    loadRoom,
    rebuildMaps,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    updateSelectedNode,
    setDirtyState,
    isCreatingRef,
  } = deps

  // ===== Internal helpers =====

  const scheduleSave = (dirPath: string) => {
    if (!dirPath) return
    setDirtyState(true)
    storage.saveGraphDebounced(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      () => setDirtyState(false)
    )
  }

  const saveNow = async (dirPath: string) => {
    if (!dirPath) return
    setDirtyState(true)
    await storage.flushGraphSave(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      () => setDirtyState(false)
    )
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    getActiveNavState,
    loadRoom,
    rebuildMaps,
    saveNow,
    scheduleSave,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    setDirtyState,
    isCreatingRef,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    edgesRef,
    getActiveNavState,
    rebuildMaps,
    scheduleSave,
    setState,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    nodesRef,
    edgesRef,
    getActiveNavState,
    getActiveSelectedNodeId,
    rebuildMaps,
    scheduleSave,
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
    scheduleSave,
    saveNow,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>
