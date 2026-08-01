import type { FlowchartCell } from './flowchartDocumentTypes'

export interface FlowchartCellPatch {
  id: string
  cell: FlowchartCell
  removeKeys: string[]
}

export interface FlowchartCellSyncPlan {
  removeEdgeIds: string[]
  removeNodeIds: string[]
  addNodes: FlowchartCell[]
  updateNodes: FlowchartCellPatch[]
  addEdges: FlowchartCell[]
  updateEdges: FlowchartCellPatch[]
}

function isEdgeCell(cell: FlowchartCell) {
  return cell.shape === 'edge' || cell.shape === 'custom-edge'
}

function serializeCell(cell: FlowchartCell) {
  return JSON.stringify(cell)
}

function createPatch(current: FlowchartCell, next: FlowchartCell): FlowchartCellPatch {
  return {
    id: next.id,
    cell: next,
    removeKeys: Object.keys(current).filter((key) => key !== 'id' && !(key in next)),
  }
}

export function planFlowchartCellSync(
  currentCells: FlowchartCell[],
  nextCells: FlowchartCell[],
): FlowchartCellSyncPlan {
  const currentById = new Map(currentCells.map((cell) => [cell.id, cell]))
  const nextById = new Map(nextCells.map((cell) => [cell.id, cell]))
  const replacedNodeIds = new Set(
    nextCells
      .filter((next) => {
        const current = currentById.get(next.id)
        return Boolean(current && !isEdgeCell(current) && !isEdgeCell(next) && current.shape !== next.shape)
      })
      .map((cell) => cell.id),
  )
  const shouldReplace = (current: FlowchartCell, next: FlowchartCell) => {
    if (isEdgeCell(current) !== isEdgeCell(next)) return true
    if (!isEdgeCell(next) && current.shape !== next.shape) return true
    if (!isEdgeCell(next)) return false
    const sourceId = next.source?.cell
    const targetId = next.target?.cell
    return Boolean(
      (sourceId && replacedNodeIds.has(sourceId))
      || (targetId && replacedNodeIds.has(targetId)),
    )
  }
  const removeEdgeIds: string[] = []
  const removeNodeIds: string[] = []
  const addNodes: FlowchartCell[] = []
  const updateNodes: FlowchartCellPatch[] = []
  const addEdges: FlowchartCell[] = []
  const updateEdges: FlowchartCellPatch[] = []

  for (const current of currentCells) {
    const next = nextById.get(current.id)
    if (next && !shouldReplace(current, next)) continue
    if (isEdgeCell(current)) removeEdgeIds.push(current.id)
    else removeNodeIds.push(current.id)
  }

  for (const next of nextCells) {
    const current = currentById.get(next.id)
    const nextIsEdge = isEdgeCell(next)
    if (!current || shouldReplace(current, next)) {
      if (nextIsEdge) addEdges.push(next)
      else addNodes.push(next)
      continue
    }

    if (serializeCell(current) === serializeCell(next)) continue

    const patch = createPatch(current, next)
    if (nextIsEdge) updateEdges.push(patch)
    else updateNodes.push(patch)
  }

  return {
    removeEdgeIds,
    removeNodeIds,
    addNodes,
    updateNodes,
    addEdges,
    updateEdges,
  }
}
