import type { GraphMeta } from '../../core/storage/types'
import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import { basenameRef, isSameOrChildRef, joinRefs } from '../graph/path-utils'

export interface CardServiceStorage {
  createCard: (parentRef: string, name: string) => Promise<string | null>
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

async function readLayoutOrEmpty(storage: CardServiceStorage, roomRef: string): Promise<GraphMeta> {
  try {
    return await storage.readLayout(roomRef)
  } catch {
    return emptyLayout()
  }
}

function createLayoutNode(id: string, cardRef: string, name: string, position?: { x: number; y: number }): LayoutNode {
  return {
    id,
    card: { ref: cardRef, name, updatedAt: undefined },
    height: 150,
    width: 200,
    position,
  }
}

function findNodeEntryKey(nodes: GraphMeta['nodes'], targetRef: string, fallbackName: string): string | null {
  for (const [key, value] of Object.entries(nodes)) {
    const normalizedKey = basenameRef(key)
    const entryName = value.card?.name
    if (key === targetRef || normalizedKey === fallbackName || entryName === fallbackName) {
      return key
    }
  }
  return null
}

function normalizeCreatedChildRef(parentRef: string, createdRef: string, name: string): string {
  if (isSameOrChildRef(parentRef, createdRef) && createdRef !== parentRef) {
    return createdRef
  }

  return joinRefs(parentRef, basenameRef(createdRef) || name)
}

export interface CreateChildCardOptions {
  name: string
  parentRef: string
  reloadRef: string
  nodesById: Map<string, KnowledgeNode>
  position?: { x: number; y: number }
}

export interface CreateChildCardResult {
  newRef: string | null
  reloadRef: string
}

export async function createChildCard(
  storage: CardServiceStorage,
  options: CreateChildCardOptions
): Promise<CreateChildCardResult> {
  const newRef = await storage.createCard(options.parentRef, options.name)
  const createdRef = (newRef ?? '').trim()
  if (!createdRef) {
    throw new Error('创建卡片失败：未返回卡片路径')
  }
  const resolvedRef = normalizeCreatedChildRef(options.parentRef, createdRef, options.name)
  const cardKey = basenameRef(resolvedRef) || options.name

  const parentLayout = await readLayoutOrEmpty(storage, options.parentRef)
  await storage.writeLayout(options.parentRef, {
    ...parentLayout,
    nodes: {
      ...parentLayout.nodes,
      [cardKey]: createLayoutNode(cardKey, resolvedRef, options.name, options.position),
    },
    edges: parentLayout.edges,
  })

  const currentRoomLayout = await readLayoutOrEmpty(storage, options.reloadRef)
  const roomNodes = { ...currentRoomLayout.nodes }
  const parentName = options.nodesById.get(options.parentRef)?.data.label ?? basenameRef(options.parentRef)
  const parentEntryKey = findNodeEntryKey(roomNodes, options.parentRef, parentName)

  if (parentEntryKey && roomNodes[parentEntryKey]) {
    roomNodes[parentEntryKey] = { ...roomNodes[parentEntryKey] }
  }

  if (!roomNodes[cardKey]) {
    roomNodes[cardKey] = createLayoutNode(cardKey, resolvedRef, options.name, options.position)
  } else if (options.position) {
    roomNodes[cardKey] = { ...roomNodes[cardKey], position: options.position }
  }

  await storage.writeLayout(options.reloadRef, {
    ...currentRoomLayout,
    nodes: roomNodes,
    edges: currentRoomLayout.edges,
  })

  return { newRef, reloadRef: options.reloadRef }
}

export async function deleteCardAndPruneGraph(
  storage: CardServiceStorage,
  cardRef: string,
  nodesById: Map<string, KnowledgeNode>,
  edgesById: Map<string, KnowledgeEdge>
): Promise<void> {
  await storage.deleteCard(cardRef)
  nodesById.delete(cardRef)
  for (const [edgeId, edge] of edgesById.entries()) {
    if (edge.source === cardRef || edge.target === cardRef) {
      edgesById.delete(edgeId)
    }
  }
}

export async function renameCard(storage: CardServiceStorage, cardRef: string, newName: string): Promise<void> {
  await storage.renameCard(cardRef, newName)
}
