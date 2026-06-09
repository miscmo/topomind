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
  createCard: (parentRef: string, cardName: string, cardId?: string) => Promise<string | null>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  scheduleGraphSave: (roomRef: string, buildMeta: () => GraphMeta, onSaved: (() => void) | undefined) => Promise<void>
  flushGraphSave: (roomRef: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => Promise<void>
  hasPendingGraphSave: (roomRef: string) => boolean
  readLayout: (roomRef: string) => Promise<GraphMeta>
  writeLayout: (roomRef: string, meta: GraphMeta) => Promise<void>
}

export interface GraphOpsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => GraphSession
  loadRoom: (roomRef: string, isCreating?: boolean) => Promise<void>
  isCreatingRef: { current: boolean }
  currentLoadedRoomRef: { current: string }
  storeApi: StoreApi<GraphState>
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    isCreatingRef,
    currentLoadedRoomRef,
    storeApi,
  } = deps

  // ===== Internal helpers =====

  const buildCurrentMeta = () => {
    const store = storeApi.getState()
    return buildMetaFromNodesEdges(
      Array.from(store.nodesMap.values()),
      Array.from(store.edgesMap.values()),
      { zoom: store.viewport.zoom, pan: { x: store.viewport.x, y: store.viewport.y } }
    )
  }

  const scheduleSave = async (roomRef: string) => {
    if (!roomRef) return
    if (currentLoadedRoomRef.current !== roomRef) {
      return
    }
    await storage.scheduleGraphSave(roomRef, buildCurrentMeta, undefined)
  }

  const saveNow = async (roomRef: string) => {
    if (!roomRef) return
    if (currentLoadedRoomRef.current !== roomRef) {
      return
    }
    await storage.flushGraphSave(
      roomRef,
      buildCurrentMeta,
      undefined
    )
  }

  const hasPendingSave = (roomRef: string) => {
    if (!roomRef || currentLoadedRoomRef.current !== roomRef) {
      return false
    }
    return storage.hasPendingGraphSave(roomRef)
  }

  // ===== Node CRUD =====

  const nodeCrudOps = buildNodeCrudOperations({
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
    isCreatingRef,
    storeApi,
  })

  // ===== Edge CRUD =====

  const edgeOps = buildEdgeOperations({
    getActiveGraphSession,
    saveNow,
    storeApi,
  })

  // ===== Node position changes =====

  const nodeChangeOps = buildNodeChangeOperations({
    tabId,
    getActiveGraphSession,
    scheduleSave,
    saveNow,
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
    scheduleSave,
    hasPendingSave,
    saveNow,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>
