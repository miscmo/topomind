import type { GraphMeta } from '../../domain/graph/model'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { basenameRef } from '../../domain/graph/path-utils'

export interface CardNodeServiceStorage {
  createCard: (parentRef: string, name: string, cardId?: string) => Promise<string | null>
  deleteCard: (cardRef: string) => Promise<unknown>
  renameCard: (cardRef: string, newName: string) => Promise<unknown>
  readLayout: (roomRef: string) => Promise<GraphMeta>
  writeLayout: (roomRef: string, meta: GraphMeta) => Promise<void>
}

type LayoutNode = GraphMeta['nodes'][string]

const emptyLayout = (): GraphMeta => ({
  nodes: {},
  edges: [],
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
})

async function readLayoutOrEmpty(storage: CardNodeServiceStorage, roomRef: string): Promise<GraphMeta> {
  try {
    return await storage.readLayout(roomRef)
  } catch {
    return emptyLayout()
  }
}

function createLayoutNode(id: string, cardRef: string, name: string, position?: { x: number; y: number }, size?: { width: number; height: number }): LayoutNode {
  return {
    id,
    card: { ref: cardRef, name, updatedAt: undefined },
    height: size?.height ?? 52,
    width: size?.width ?? 120,
    position,
  }
}

export interface CreateChildCardOptions {
  name: string
  parentRef: string
  reloadRef: string
  cardId: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
}

export interface CreateChildCardResult {
  newRef: string | null
  reloadRef: string
}

export async function createChildCardNode(
  storage: CardNodeServiceStorage,
  options: CreateChildCardOptions
): Promise<CreateChildCardResult> {
  const newRef = await storage.createCard(options.parentRef, options.name, options.cardId)
  const createdRef = (newRef ?? '').trim()
  if (!createdRef) {
    throw new Error('创建卡片失败：未返回卡片路径')
  }
  const cardKey = basenameRef(createdRef) || options.cardId

  const parentLayout = await readLayoutOrEmpty(storage, options.parentRef)
  await storage.writeLayout(options.parentRef, {
    ...parentLayout,
    nodes: {
      ...parentLayout.nodes,
      [cardKey]: createLayoutNode(cardKey, cardKey, options.name, options.position, options.size),
    },
    edges: parentLayout.edges,
  })

  return { newRef, reloadRef: options.reloadRef }
}

export async function deleteCardNodeAndPruneGraph(
  storage: CardNodeServiceStorage,
  cardRef: string,
  nodeId: string,
  nodesById: Map<string, KnowledgeNode>,
  edgesById: Map<string, KnowledgeEdge>
): Promise<void> {
  await storage.deleteCard(cardRef)
  nodesById.delete(nodeId)
  for (const [edgeId, edge] of edgesById.entries()) {
    if (edge.source === nodeId || edge.target === nodeId) {
      edgesById.delete(edgeId)
    }
  }
}

export async function renameCardNode(storage: CardNodeServiceStorage, cardRef: string, newName: string): Promise<void> {
  await storage.renameCard(cardRef, newName)
}
