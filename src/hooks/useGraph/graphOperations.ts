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
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

import type { GraphSession } from '../../stores/tabs/tabStore'

export interface StorageApi {
  saveGraphDebounced: (dirPath: string, buildMeta: () => GraphMeta, onSaved: (() => void) | undefined) => Promise<void>
  hasPendingGraphSave: (dirPath: string) => boolean
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
  getActiveGraphSession: () => GraphSession
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  isCreatingRef: { current: boolean }
  currentLoadedRoomPathRef: { current: string }
  storeApi: StoreApi<GraphState>
}

export interface GraphSaveSnapshot {
  dirPath: string
  meta: GraphMeta
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    isCreatingRef,
    currentLoadedRoomPathRef,
    storeApi,
  } = deps

  // ===== Internal helpers =====

  const buildGraphMetaSnapshot = (store: GraphState): GraphMeta => buildMetaFromNodesEdges(
    Array.from(store.nodesMap.values()),
    Array.from(store.edgesMap.values()),
    { zoom: store.viewport.zoom, pan: { x: store.viewport.x, y: store.viewport.y } }
  )

  const captureSaveSnapshot = (dirPath: string): GraphSaveSnapshot | null => {
    if (!dirPath) return null
    if (currentLoadedRoomPathRef.current !== dirPath) {
      return null
    }
    return {
      dirPath,
      meta: buildGraphMetaSnapshot(storeApi.getState()),
    }
  }

  const saveSnapshot = async (snapshot: GraphSaveSnapshot | null) => {
    if (!snapshot?.dirPath) return
    await storage.flushGraphSave(snapshot.dirPath, () => snapshot.meta, undefined)
  }

  const scheduleSaveSnapshot = async (snapshot: GraphSaveSnapshot | null) => {
    if (!snapshot?.dirPath) return
    await storage.saveGraphDebounced(snapshot.dirPath, () => snapshot.meta, undefined)
  }

  const saveNow = async (dirPath: string) => {
    await saveSnapshot(captureSaveSnapshot(dirPath))
  }

  const saveLater = async (dirPath: string) => {
    await scheduleSaveSnapshot(captureSaveSnapshot(dirPath))
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
      saveLater,
    isCreatingRef,
    storeApi,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    getActiveGraphSession,
    saveNow,
      saveLater,
    storeApi,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    tabId,
    getActiveGraphSession,
    saveNow,
      saveLater,
    storeApi,
  })

  // ===== Selection =====

  const selectionOps = buildSelectionOperations({
    tabId,
    storeApi,
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
    captureSaveSnapshot,
    saveSnapshot,
    scheduleSaveSnapshot,
    saveNow,
    saveLater,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>
