import type { GraphMeta } from '../../core/storage/types'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { buildEdges, buildNodes } from './graphBuilder'

export interface RoomLoaderStorage {
  readLayout: (dirPath: string) => Promise<GraphMeta>
  countChildren: (dirPath: string) => Promise<number>
}

export interface LoadedRoomGraph {
  meta: GraphMeta
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  savedPositions: Record<string, { x: number; y: number }>
}

export async function loadRoomGraph(
  storage: RoomLoaderStorage,
  dirPath: string,
  kbPath: string
): Promise<LoadedRoomGraph> {
  const meta = await storage.readLayout(dirPath)
  const savedPositions: Record<string, { x: number; y: number }> = {}
  const nodeEntries = Object.entries(meta.nodes ?? {})

  if (nodeEntries.length > 0) {
    const positionResults = await Promise.allSettled(
      nodeEntries.map(async ([nodeId, node]) => {
        const childPath = resolveRoomChildRef(dirPath, node.card?.ref || node.id || nodeId)
        const childMeta = await storage.readLayout(childPath)
        return { childPath, childMeta }
      })
    )

    for (const result of positionResults) {
      if (
        result.status === 'fulfilled' &&
        result.value.childMeta.viewport.zoom != null &&
        result.value.childMeta.viewport.pan != null
      ) {
        savedPositions[result.value.childPath] = {
          x: result.value.childMeta.viewport.pan.x,
          y: result.value.childMeta.viewport.pan.y,
        }
      }
    }
  }

  return {
    meta,
    savedPositions,
    nodes: await buildNodes(storage, dirPath, meta, savedPositions, kbPath),
    edges: buildEdges(meta, dirPath),
  }
}
