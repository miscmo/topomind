import type { GraphMeta } from '../../core/storage'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { normalizeRef, resolveRoomChildRef } from '../../domain/graph/path-utils'
import { buildEdges, buildNodes } from './graphBuilder'

export interface RoomLoaderStorage {
  readLayout: (roomRef: string) => Promise<GraphMeta>
  countChildren: (cardRef: string) => Promise<number>
  listTopoDocuments?: (cardPath: string) => Promise<unknown[]>
}

export interface LoadedRoomGraph {
  meta: GraphMeta
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  savedPositions: Record<string, { x: number; y: number }>
}

export async function loadRoomGraph(
  storage: RoomLoaderStorage,
  roomRef: string,
  kbId: string
): Promise<LoadedRoomGraph> {
  const meta = await storage.readLayout(roomRef)
  const savedPositions: Record<string, { x: number; y: number }> = {}
  const nodeEntries = Object.entries(meta.nodes ?? {})

  if (nodeEntries.length > 0) {
    const positionResults = await Promise.allSettled(
      nodeEntries.map(async ([nodeId, node]) => {
        const childId = normalizeRef(node.card?.ref || node.id || nodeId)
        const childPath = resolveRoomChildRef(roomRef, childId)
        const childMeta = await storage.readLayout(childPath)
        return { childId, childMeta }
      })
    )

    for (const result of positionResults) {
      if (
        result.status === 'fulfilled' &&
        result.value.childMeta.viewport.zoom != null &&
        result.value.childMeta.viewport.pan != null
      ) {
        savedPositions[result.value.childId] = {
          x: result.value.childMeta.viewport.pan.x,
          y: result.value.childMeta.viewport.pan.y,
        }
      }
    }
  }

  return {
    meta,
    savedPositions,
    nodes: await buildNodes(storage, roomRef, meta, savedPositions, kbId),
    edges: buildEdges(meta, roomRef),
  }
}
