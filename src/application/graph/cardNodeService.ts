import type { GraphMeta } from '../../domain/graph/model'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { joinRefs } from '../../domain/graph/path-utils'

export interface CardNodeServiceStorage {
  // P0 起新建节点不再建目录：只写父 _graph.json.children。
  // 节点目录由「创建文档 / 首次在房间内写入 / 导入附件」按需 ensureDir 物化，
  // 磁盘格式零变更、旧库零迁移（读侧本来就把「无目录」当空图）。
  deleteCard: (cardRef: string, label?: string) => Promise<unknown>
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
  // cardId 形如 `card-<uuid>`，本身就是合法且唯一的目录名；此刻**不创建任何磁盘目录**。
  // 只有节点真的拥有文档、附件或子房间时，写侧的 ensureDir 才会把目录物化出来。
  const cardKey = options.cardId
  const parentLayout = await readLayoutOrEmpty(storage, options.parentRef)
  if (parentLayout.nodes[cardKey]) {
    throw new Error('创建卡片失败：节点 ID 冲突 ' + cardKey)
  }

  await storage.writeLayout(options.parentRef, {
    ...parentLayout,
    nodes: {
      ...parentLayout.nodes,
      [cardKey]: createLayoutNode(cardKey, cardKey, options.name, options.position, options.size),
    },
    edges: parentLayout.edges,
  })

  // newRef 只是逻辑路径（日志/定位用），不代表磁盘上已经有目录。
  return { newRef: joinRefs(options.parentRef, cardKey), reloadRef: options.reloadRef }
}

export async function deleteCardNodeAndPruneGraph(
  storage: CardNodeServiceStorage,
  cardRef: string,
  nodeId: string,
  nodesById: Map<string, KnowledgeNode>,
  edgesById: Map<string, KnowledgeEdge>
): Promise<void> {
  const node = nodesById.get(nodeId)
  await storage.deleteCard(cardRef, node?.data?.label)
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
