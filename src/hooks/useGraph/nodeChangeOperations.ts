import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface NodeChangeOperationsDeps {
  tabId: string
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
}

export function buildNodeChangeOperations(deps: NodeChangeOperationsDeps) {
  const {
    tabId,
    getActiveGraphSession,
    saveNow,
    storeApi,
  } = deps

  const applyNodePositionChanges = async (changes: Array<{ id: string; position: { x: number; y: number } }>) => {
    let changed = false
    const store = storeApi.getState()
    const nextNodes = store.nodes.map((n) => {
      const change = changes.find(c => c.id === n.id)
      if (change && change.position) {
        changed = true
        return { ...n, position: change.position }
      }
      return n
    })
    
    if (changed) {
      store.setNodes(nextNodes)
      const graphSession = getActiveGraphSession()
      const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
      if (currentRoomPath) await saveNow(currentRoomPath)
    }
  }

  const applyNodeRemoveChanges = async (changeIds: string[]) => {
    const store = storeApi.getState()
    store.removeNodes(changeIds)
    store.removeEdgesByNodeIds(changeIds)
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    if (currentRoomPath) await saveNow(currentRoomPath)
  }

  const applyNodeDimensionChanges = async (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean }>) => {
    let shouldSave = false
    const store = storeApi.getState()
    const nextNodes = store.nodes.map((n) => {
      const change = changes.find((c) => c.id === n.id)
      if (!change) return n
      if (change.dimensions && !change.resizing) {
        shouldSave = true
      }
      return {
        ...n,
        width: change.dimensions?.width ?? n.width,
        height: change.dimensions?.height ?? n.height,
        measured: change.dimensions === undefined ? n.measured : (change.dimensions || undefined),
      }
    })
    
    store.setNodes(nextNodes)
    
    if (shouldSave) {
      const graphSession = getActiveGraphSession()
      const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
      if (currentRoomPath) await saveNow(currentRoomPath)
    }
  }

  const applyNodeSelectionChanges = (changes: Array<{ id: string; selected: boolean }>) => {
    let changed = false
    const store = storeApi.getState()
    const nextNodes = store.nodes.map((n) => {
      const change = changes.find(c => c.id === n.id)
      if (change && n.selected !== change.selected) {
        changed = true
        return { ...n, selected: change.selected }
      }
      return n
    })
    
    if (changed) {
      store.setNodes(nextNodes)
    }
  }

  return {
    applyNodePositionChanges,
    applyNodeRemoveChanges,
    applyNodeDimensionChanges,
    applyNodeSelectionChanges,
  }
}
