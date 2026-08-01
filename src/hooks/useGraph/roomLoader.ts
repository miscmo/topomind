import type { GraphMeta } from '../../core/storage'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { buildEdges, buildNodes } from './graphBuilder'

export interface RoomLoaderStorage {
  readLayout: (dirPath: string) => Promise<GraphMeta>
  readRoomNodeSummaries: (roomPaths: string[]) => Promise<Record<string, {
    position?: { x: number; y: number }
    childCount: number
    hasDetail: boolean
  }>>
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
  const roomPaths = Object.entries(meta.nodes ?? {}).map(([nodeId, node]) => (
    resolveRoomChildRef(dirPath, node.card?.ref || node.id || nodeId)
  ))
  const summaries = roomPaths.length > 0
    ? await storage.readRoomNodeSummaries(roomPaths)
    : {}
  const savedPositions = Object.fromEntries(
    Object.entries(meta.nodes ?? {}).flatMap(([nodeId, node]) => {
      const roomPath = resolveRoomChildRef(dirPath, node.card?.ref || node.id || nodeId)
      const position = summaries[roomPath]?.position
      return position ? [[nodeId, position]] : []
    })
  )

  return {
    meta,
    savedPositions,
    nodes: buildNodes(dirPath, meta, summaries, kbPath),
    edges: buildEdges(meta, dirPath),
  }
}
