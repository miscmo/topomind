import type { GraphMeta } from '../../core/storage'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { graphMetaToRoomGraph } from '../../domain/graph/graphMapper'
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

  // 一次转换同时喂给 buildNodes / buildEdges：旧实现各调一次，等于把
  // 1469 节点 + 1427 边的全量 GraphMeta→RoomGraph 转换白跑一遍。
  const roomGraph = graphMetaToRoomGraph(dirPath, meta)
  return {
    meta,
    savedPositions,
    nodes: buildNodes(dirPath, meta, summaries, kbPath, roomGraph),
    edges: buildEdges(meta, dirPath, roomGraph),
  }
}
