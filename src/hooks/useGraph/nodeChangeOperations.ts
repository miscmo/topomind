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

  const applyNodePositionChanges = async (changes: Array<{ id: string; position?: { x: number; y: number }; dragging?: boolean }>) => {
    let changed = false
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const nextNodes = store.nodes.map((n) => {
      const change = changesById.get(n.id)
      if (change && change.position) {
        if (n.position.x === change.position.x && n.position.y === change.position.y) return n
        changed = true
        return { ...n, position: change.position }
      }
      return n
    })
    
    const isDragging = changes.some((change) => change.dragging === true)
    const isDragEnd = changes.some((change) => change.dragging === false)
    
    const temporalState = (storeApi as any).temporal?.getState?.()
    
    if (temporalState) {
      if (isDragging && !isDragEnd) {
        temporalState.pause()
      } else {
        temporalState.resume()
      }
    }

    if (changed || isDragEnd) {
      store.setNodes(changed ? nextNodes : store.nodes)
    }

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const shouldSaveNow = changes.some((change) => change.dragging === false)
    if (currentRoomPath && shouldSaveNow) {
      await saveNow(currentRoomPath)
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

  const applyNodeDimensionChanges = async (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean; origin?: 'auto-size' | 'manual' }>) => {
    let shouldSave = false
    let changed = false
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const nextNodes = store.nodes.map((n) => {
      const change = changesById.get(n.id)
      if (!change) return n
      const nextWidth = change.dimensions?.width ?? n.width ?? n.initialWidth ?? n.measured?.width ?? 120
      const nextHeight = change.dimensions?.height ?? n.height ?? n.initialHeight ?? n.measured?.height ?? 52
      const nextMeasured = change.dimensions === undefined ? n.measured : (change.dimensions || undefined)
      if (n.width === nextWidth && n.height === nextHeight && n.measured === nextMeasured) return n
      if (change.dimensions && !change.resizing) {
        shouldSave = true
      }
      changed = true

      const isExpanded = nextWidth >= 160 && nextHeight >= 96
      const wasExpanded = (n.width ?? 0) >= 160 && (n.height ?? 0) >= 96
      
      const expandedDimensions: Record<string, number> = {}
      if (isExpanded) {
        expandedDimensions.expandedWidth = nextWidth
        expandedDimensions.expandedHeight = nextHeight
      } else {
        expandedDimensions.collapsedWidth = nextWidth
        expandedDimensions.collapsedHeight = nextHeight
      }
      
      // If transitioning from expanded to collapsed, save the previous expanded dimensions
      if (!isExpanded && wasExpanded && n.width !== undefined && n.height !== undefined) {
        expandedDimensions.expandedWidth = n.width
        expandedDimensions.expandedHeight = n.height
      }
      
      // If transitioning from collapsed to expanded, save the previous collapsed dimensions
      if (isExpanded && !wasExpanded && n.width !== undefined && n.height !== undefined) {
        expandedDimensions.collapsedWidth = n.width
        expandedDimensions.collapsedHeight = n.height
      }

      const isAutoSizeChange = change.origin === 'auto-size'
      const prevWidth = n.width ?? n.initialWidth ?? n.measured?.width ?? 120
      const prevHeight = n.height ?? n.initialHeight ?? n.measured?.height ?? 52
      const widthChanged = Math.abs(prevWidth - nextWidth) > 0.5
      const heightChanged = Math.abs(prevHeight - nextHeight) > 0.5
      const shouldSwitchToManual = !isAutoSizeChange && (widthChanged || heightChanged)
      return {
        ...n,
        width: nextWidth,
        height: nextHeight,
        measured: nextMeasured,
        data: {
          ...n.data,
          ...expandedDimensions,
          ...(shouldSwitchToManual ? { widthMode: 'manual' as const, heightMode: 'manual' as const } : {}),
        }
      }
    })
    
    const isResizing = changes.some((change) => change.resizing === true)
    const temporalState = (storeApi as any).temporal?.getState?.()
    
    if (temporalState) {
      if (isResizing) {
        temporalState.pause()
      } else {
        temporalState.resume()
      }
    }

    if (changed) store.setNodes(nextNodes)
    
    if (changed && shouldSave) {
      const graphSession = getActiveGraphSession()
      const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
      if (currentRoomPath) await saveNow(currentRoomPath)
    }
  }

  const applyNodeSelectionChanges = (changes: Array<{ id: string; selected: boolean }>) => {
    let changed = false
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const nextNodes = store.nodes.map((n) => {
      const change = changesById.get(n.id)
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
