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
import { useGraphStore } from '../../stores/graphStore'

export interface StorageApi {
  createCard: (parentPath: string, cardName: string) => Promise<string | null>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  flushGraphSave: (dirPath: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => Promise<void>
  readLayout: (dirPath: string) => Promise<GraphMeta>
  writeLayout: (dirPath: string, meta: GraphMeta) => Promise<void>
}

export interface GraphOpsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  isCreatingRef: { current: boolean }
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    isCreatingRef,
  } = deps

  // ===== Internal helpers =====

  const saveNow = async (dirPath: string) => {
    if (!dirPath) return
    const store = useGraphStore.getState()
    await storage.flushGraphSave(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(store.nodesMap.values()),
        Array.from(store.edgesMap.values())
      ),
      undefined
    )
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
    isCreatingRef,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    getActiveGraphSession,
    saveNow,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    tabId,
    getActiveGraphSession,
    saveNow,
  })

  // ===== Selection =====

  const selectionOps = buildSelectionOperations({
    tabId,
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
