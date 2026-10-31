import {
  captureGraphHistorySnapshot,
  commitGraphHistorySnapshot,
  type GraphHistorySnapshot,
  type GraphState,
  type GraphStoreApi,
} from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface NodeChangeOperationsDeps {
  tabId: string
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveNow: (dirPath: string) => Promise<void>
  saveLater: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
}

type GNode = GraphState['nodes'][number]

// Build the next nodes array incrementally: only entries present in `changesById`
// get a fresh object (via `apply`); every other node keeps its original reference,
// so React Flow's memoized node components skip re-rendering. Early-returns null when
// nothing actually changed, letting callers skip the store update entirely.
//
// The id->index map is built from `nodes` on every call (O(n) Map build, no per-node
// object allocation). This deliberately avoids relying on any cached/store-level index,
// which can be stale or empty (e.g. right after load / undo) and would make every change
// silently skipped — leaving dragged nodes stuck in place. The per-frame cost stays
// dominated by O(changed) for the actual node updates, which is what matters as the
// graph grows into the thousands.
function computeIncrementalNodes<T>(
  nodes: GNode[],
  changesById: Map<string, T>,
  apply: (node: GNode, change: T) => { changed: boolean; node: GNode },
): { nextNodes: GNode[]; changedIds: string[] } | null {
  const nodeIndexById = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) {
    nodeIndexById.set(nodes[i].id, i)
  }

  const changedIds: string[] = []
  const nextById = new Map<string, GNode>()
  for (const [id, change] of changesById) {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) continue
    const result = apply(nodes[idx], change)
    if (result.changed) {
      nextById.set(id, result.node)
      changedIds.push(id)
    }
  }
  if (changedIds.length === 0) return null
  const nextNodes = nodes.slice()
  for (const id of changedIds) {
    const idx = nodeIndexById.get(id)!
    nextNodes[idx] = nextById.get(id)!
  }
  return { nextNodes, changedIds }
}

export function buildNodeChangeOperations(deps: NodeChangeOperationsDeps) {
  const {
    getActiveGraphSession,
    saveLater,
    storeApi,
  } = deps

  const graphStoreApi = storeApi as GraphStoreApi
  let dragHistoryBaseline: GraphHistorySnapshot | null = null
  let resizeHistoryBaseline: GraphHistorySnapshot | null = null

  const beginInteractionHistory = (kind: 'drag' | 'resize') => {
    const baseline = kind === 'drag' ? dragHistoryBaseline : resizeHistoryBaseline
    if (baseline) return
    const nextBaseline = captureGraphHistorySnapshot(storeApi.getState())
    if (kind === 'drag') dragHistoryBaseline = nextBaseline
    else resizeHistoryBaseline = nextBaseline
    graphStoreApi.temporal.getState().pause()
  }

  const finishInteractionHistory = (kind: 'drag' | 'resize') => {
    const baseline = kind === 'drag' ? dragHistoryBaseline : resizeHistoryBaseline
    if (!baseline) return
    if (kind === 'drag') dragHistoryBaseline = null
    else resizeHistoryBaseline = null
    const otherInteractionActive = kind === 'drag' ? resizeHistoryBaseline !== null : dragHistoryBaseline !== null
    if (!otherInteractionActive) graphStoreApi.temporal.getState().resume()
    commitGraphHistorySnapshot(graphStoreApi, baseline)
  }

  const applyNodePositionChanges = async (changes: Array<{ id: string; position?: { x: number; y: number }; dragging?: boolean }>) => {
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
      const cp = change.position
      if (!cp) return { changed: false, node }
      if (node.position.x === cp.x && node.position.y === cp.y) return { changed: false, node }
      return { changed: true, node: { ...node, position: cp } }
    })

    const isDragging = changes.some((change) => change.dragging === true)
    const isDragEnd = changes.some((change) => change.dragging === false)

    if (isDragging) beginInteractionHistory('drag')
    if (isDragEnd) finishInteractionHistory('drag')

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    const shouldSaveNow = changes.some((change) => change.dragging === false)
    if (currentRoomPath && shouldSaveNow) {
      await saveLater(currentRoomPath)
    }

    if (result) {
      store.setNodesPreservingSelection(result.nextNodes, result.changedIds)
    }
  }

  const applyNodeRemoveChanges = async (changeIds: string[]) => {
    const store = storeApi.getState()
    store.removeNodes(changeIds)
    store.removeEdgesByNodeIds(changeIds)
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    if (currentRoomPath) await saveLater(currentRoomPath)
  }

  const applyNodeDimensionChanges = async (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean; origin?: 'auto-size' | 'manual' }>) => {
    let shouldSave = false
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
      const dims = change.dimensions
      const nextWidth = dims?.width ?? node.width ?? node.initialWidth ?? node.measured?.width ?? 120
      const nextHeight = dims?.height ?? node.height ?? node.initialHeight ?? node.measured?.height ?? 52
      const nextMeasured = dims === undefined ? node.measured : (dims || undefined)
      if (node.width === nextWidth && node.height === nextHeight && node.measured === nextMeasured) {
        return { changed: false, node }
      }
      if (dims && !change.resizing) {
        shouldSave = true
      }

      const isExpanded = nextWidth >= 160 && nextHeight >= 96
      const wasExpanded = (node.width ?? 0) >= 160 && (node.height ?? 0) >= 96

      const expandedDimensions: Record<string, number> = {}
      if (isExpanded) {
        expandedDimensions.expandedWidth = nextWidth
        expandedDimensions.expandedHeight = nextHeight
      } else {
        expandedDimensions.collapsedWidth = nextWidth
        expandedDimensions.collapsedHeight = nextHeight
      }

      // If transitioning from expanded to collapsed, save the previous expanded dimensions
      if (!isExpanded && wasExpanded && node.width !== undefined && node.height !== undefined) {
        expandedDimensions.expandedWidth = node.width
        expandedDimensions.expandedHeight = node.height
      }

      // If transitioning from collapsed to expanded, save the previous collapsed dimensions
      if (isExpanded && !wasExpanded && node.width !== undefined && node.height !== undefined) {
        expandedDimensions.collapsedWidth = node.width
        expandedDimensions.collapsedHeight = node.height
      }

      const isAutoSizeChange = change.origin === 'auto-size'
      const prevWidth = node.width ?? node.initialWidth ?? node.measured?.width ?? 120
      const prevHeight = node.height ?? node.initialHeight ?? node.measured?.height ?? 52
      const widthChanged = Math.abs(prevWidth - nextWidth) > 0.5
      const heightChanged = Math.abs(prevHeight - nextHeight) > 0.5
      const shouldSwitchToManual = !isAutoSizeChange && (widthChanged || heightChanged)
      return {
        changed: true,
        node: {
          ...node,
          width: nextWidth,
          height: nextHeight,
          measured: nextMeasured,
          data: {
            ...node.data,
            ...expandedDimensions,
            ...(shouldSwitchToManual ? { widthMode: 'manual' as const, heightMode: 'manual' as const } : {}),
          },
        },
      }
    })

    const isResizing = changes.some((change) => change.resizing === true)
    const isResizeEnd = changes.some((change) => change.resizing === false)
    if (isResizing) beginInteractionHistory('resize')

    if (result) store.setNodesPreservingSelection(result.nextNodes, result.changedIds)
    if (isResizeEnd) finishInteractionHistory('resize')

    if (shouldSave) {
      const graphSession = getActiveGraphSession()
      const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
      if (currentRoomPath) await saveLater(currentRoomPath)
    }
  }

  const applyNodeSelectionChanges = (changes: Array<{ id: string; selected: boolean }>) => {
    const store = storeApi.getState()
    const changesById = new Map(changes.map((change) => [change.id, change]))
    const result = computeIncrementalNodes(store.nodes, changesById, (node, change) => {
      if (node.selected === change.selected) return { changed: false, node }
      return { changed: true, node: { ...node, selected: change.selected } }
    })

    if (result) {
      store.setNodes(result.nextNodes)
    }
  }

  return {
    applyNodePositionChanges,
    applyNodeRemoveChanges,
    applyNodeDimensionChanges,
    applyNodeSelectionChanges,
  }
}
