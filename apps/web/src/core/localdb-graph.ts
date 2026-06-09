import type { GraphMeta, Store } from './storage'
import { SaveCoordinator } from '../domain/persistence/saveCoordinator'
import { LocalDB } from './localdb-backend'
import { logger } from './logger'
import type {
  LocalCardRecord,
  LocalDocumentRecord,
  LocalGraphLayoutRecord,
  LocalWorkspaceSnapshot,
} from '../types/local-sync'
import { DEFAULT_NODE_SIZE, DEFAULT_VIEWPORT } from '../domain/graph/model'
import { normalizeGraphMeta } from '../domain/graph/normalizeGraphMeta'
import { basenameRef, normalizeRef } from '../domain/graph/path-utils'

const SNAPSHOT_CACHE_TTL_MS = 250

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toRoomScope(roomRef: string) {
  const normalized = normalizeRef(roomRef)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) {
    throw new Error('roomRef is required')
  }
  return {
    roomRef: normalized,
    kbId: parts[0],
    roomCardId: parts.length > 1 ? parts[parts.length - 1] : null,
  }
}

function findLayoutByScope(snapshot: LocalWorkspaceSnapshot, roomRef: string) {
  const scope = toRoomScope(roomRef)
  return findLayout(snapshot, scope.kbId, scope.roomCardId)
}

function getCardChildren(snapshot: LocalWorkspaceSnapshot, kbId: string, parentId: string | null) {
  return snapshot.cards
    .filter((card) => !card.deletedAt && card.kbId === kbId && (card.parentId ?? null) === parentId)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name, 'zh-CN')
    })
}

function findLayout(snapshot: LocalWorkspaceSnapshot, kbId: string, roomCardId: string | null) {
  return (
    snapshot.graphLayouts.find(
      (layout) => layout.kbId === kbId && (layout.roomCardId ?? null) === roomCardId,
    ) ?? null
  )
}

function buildLayoutNodeMap(layoutJson: Record<string, unknown>) {
  const nodes = layoutJson.nodes
  const children = layoutJson.children
  const result = new Map<string, Record<string, unknown>>()

  if (Array.isArray(nodes)) {
    for (const entry of nodes) {
      if (!isPlainObject(entry)) continue
      const id = normalizeRef(
        String(entry.id ?? entry.cardRef ?? (isPlainObject(entry.card) ? entry.card.ref : '') ?? ''),
      )
      if (id) result.set(id, entry)
    }
    return result
  }

  if (isPlainObject(nodes)) {
    for (const [key, value] of Object.entries(nodes)) {
      if (!isPlainObject(value)) continue
      const id = normalizeRef(
        String(value.id ?? value.cardRef ?? (isPlainObject(value.card) ? value.card.ref : key) ?? key),
      )
      if (id) result.set(id, value)
    }
    return result
  }

  if (isPlainObject(children)) {
    for (const [key, value] of Object.entries(children)) {
      if (!isPlainObject(value)) continue
      const id = normalizeRef(String(value.id ?? value.cardRef ?? key))
      if (id) result.set(id, value)
    }
  }

  return result
}

function buildGraphEdges(layoutJson: Record<string, unknown>): GraphMeta['edges'] {
  const edges = layoutJson.edges
  if (!Array.isArray(edges)) {
    return []
  }

  const parsedEdges: GraphMeta['edges'] = []
  for (const [index, edge] of edges.entries()) {
    if (!isPlainObject(edge)) {
      continue
    }
    const sourceRef = normalizeRef(
      String(edge.sourceRef ?? edge.source ?? (isPlainObject(edge.source) ? edge.source.ref : '') ?? ''),
    )
    const targetRef = normalizeRef(
      String(edge.targetRef ?? edge.target ?? (isPlainObject(edge.target) ? edge.target.ref : '') ?? ''),
    )
    if (!sourceRef || !targetRef) {
      continue
    }
    parsedEdges.push({
      id: String(edge.id ?? `edge-${index}`),
      source: { ref: sourceRef, name: '' },
      target: { ref: targetRef, name: '' },
      relation: (edge.relation as GraphMeta['edges'][number]['relation']) ?? '相关',
      weight: (edge.weight as GraphMeta['edges'][number]['weight']) ?? 'minor',
      lineMode: edge.lineMode as GraphMeta['edges'][number]['lineMode'],
      lineStyle: edge.lineStyle as GraphMeta['edges'][number]['lineStyle'],
      color: typeof edge.color === 'string' ? edge.color : undefined,
      arrow: typeof edge.arrow === 'boolean' ? edge.arrow : undefined,
      highlighted: typeof edge.highlighted === 'boolean' ? edge.highlighted : undefined,
      faded: typeof edge.faded === 'boolean' ? edge.faded : undefined,
    })
  }
  return parsedEdges
}

function buildViewport(viewportJson: Record<string, unknown>) {
  const pan = isPlainObject(viewportJson.pan)
    ? viewportJson.pan
    : viewportJson

  return {
    zoom: toFiniteNumber(viewportJson.zoom, DEFAULT_VIEWPORT.zoom),
    pan: {
      x: toFiniteNumber(pan.x, DEFAULT_VIEWPORT.pan.x),
      y: toFiniteNumber(pan.y, DEFAULT_VIEWPORT.pan.y),
    },
  }
}

function buildGraphMetaForRoom(
  snapshot: LocalWorkspaceSnapshot,
  roomRef: string,
  layout: LocalGraphLayoutRecord | null,
  roomCards: LocalCardRecord[],
): GraphMeta {
  const layoutJson = isPlainObject(layout?.layoutJson) ? layout.layoutJson : {}
  const viewportJson = isPlainObject(layout?.viewportJson) ? layout.viewportJson : {}
  const layoutNodeMap = buildLayoutNodeMap(layoutJson)

  const nodes = Object.fromEntries(
    roomCards.map((card) => {
      const layoutNode = layoutNodeMap.get(card.id) ?? {}
      const position = isPlainObject(layoutNode.position)
        ? {
            x: toFiniteNumber(layoutNode.position.x, 0),
            y: toFiniteNumber(layoutNode.position.y, 0),
          }
        : ('x' in layoutNode || 'y' in layoutNode)
          ? {
              x: toFiniteNumber(layoutNode.x, 0),
              y: toFiniteNumber(layoutNode.y, 0),
            }
          : undefined
      const style = isPlainObject(layoutNode.style) ? layoutNode.style : undefined
      const color = typeof layoutNode.color === 'string' ? layoutNode.color : undefined
      const expandedWidth = toFiniteNumber(layoutNode.expandedWidth, Number.NaN)
      const expandedHeight = toFiniteNumber(layoutNode.expandedHeight, Number.NaN)
      const baseNode: GraphMeta['nodes'][string] = {
        id: card.id,
        card: {
          ref: card.id,
          name: card.name,
          updatedAt: card.updatedAt,
        },
        width: toFiniteNumber(
          isPlainObject(layoutNode.size) ? layoutNode.size.width : layoutNode.width,
          DEFAULT_NODE_SIZE.width,
        ),
        height: toFiniteNumber(
          isPlainObject(layoutNode.size) ? layoutNode.size.height : layoutNode.height,
          DEFAULT_NODE_SIZE.height,
        ),
        position,
        expanded: typeof layoutNode.expanded === 'boolean' ? layoutNode.expanded : undefined,
        color,
        style,
      }

      if (Number.isFinite(expandedWidth)) {
        baseNode.expandedWidth = expandedWidth
      }
      if (Number.isFinite(expandedHeight)) {
        baseNode.expandedHeight = expandedHeight
      }

      return [
        card.id,
        baseNode,
      ]
    }),
  )

  return {
    nodes,
    edges: buildGraphEdges(layoutJson),
    viewport: buildViewport(viewportJson),
  }
}

export function createLocalDbGraphStorage(workspaceId: string) {
  let cachedSnapshotPromise: Promise<LocalWorkspaceSnapshot> | null = null
  let cachedAt = 0

  const resetSnapshotCache = () => {
    cachedSnapshotPromise = null
    cachedAt = 0
  }

  const getSnapshot = async () => {
    const now = Date.now()
    if (cachedSnapshotPromise && now - cachedAt <= SNAPSHOT_CACHE_TTL_MS) {
      return cachedSnapshotPromise
    }
    cachedAt = now
    cachedSnapshotPromise = LocalDB.getWorkspaceSnapshot(workspaceId)
    return cachedSnapshotPromise
  }

  const readLayout = async (roomRef: string): Promise<GraphMeta> => {
    const snapshot = await getSnapshot()
    const scope = toRoomScope(roomRef)
    const roomCards = getCardChildren(snapshot, scope.kbId, scope.roomCardId)
    const layout = findLayout(snapshot, scope.kbId, scope.roomCardId)
    return buildGraphMetaForRoom(snapshot, scope.roomRef, layout, roomCards)
  }

  const countChildren = async (roomRef: string) => {
    const snapshot = await getSnapshot()
    const scope = toRoomScope(roomRef)
    return getCardChildren(snapshot, scope.kbId, scope.roomCardId).length
  }

  const listTopoDocuments = async (roomRef: string): Promise<LocalDocumentRecord[]> => {
    const snapshot = await getSnapshot()
    const scope = toRoomScope(roomRef)
    if (!scope.roomCardId) {
      return []
    }
    return snapshot.documents
      .filter((document) => !document.deletedAt && document.cardId === scope.roomCardId)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        return a.title.localeCompare(b.title, 'zh-CN')
      })
  }

  const createCard = async (parentRef: string, cardName: string, cardId?: string) => {
    const scope = toRoomScope(parentRef)
    const normalizedCardId = normalizeRef(cardId || crypto.randomUUID())
    const result = await LocalDB.createCard({
      workspaceId,
      cardId: normalizedCardId,
      kbId: scope.kbId,
      parentId: scope.roomCardId,
      name: cardName,
      status: 'active',
      metaJson: {},
    })
    resetSnapshotCache()
    return result.id
  }

  const renameCard = async (cardRef: string, newName: string) => {
    const cardId = basenameRef(cardRef)
    if (!cardId) {
      throw new Error('cardRef is required')
    }
    const result = await LocalDB.updateCard({
      cardId,
      name: newName,
    })
    resetSnapshotCache()
    return result.id
  }

  const deleteCard = async (cardRef: string) => {
    const cardId = basenameRef(cardRef)
    if (!cardId) {
      throw new Error('cardRef is required')
    }
    const result = await LocalDB.deleteCard({
      cardId,
    })
    resetSnapshotCache()
    return result.id
  }

  const writeLayout = async (roomRef: string, meta: GraphMeta) => {
    const scope = toRoomScope(roomRef)
    const normalizedMeta = normalizeGraphMeta(meta)
    const layoutJson = {
      nodes: normalizedMeta.nodes,
      edges: normalizedMeta.edges,
    }
    const viewportJson = {
      zoom: normalizedMeta.viewport.zoom,
      pan: {
        x: normalizedMeta.viewport.pan.x,
        y: normalizedMeta.viewport.pan.y,
      },
    }
    await LocalDB.updateGraphLayout({
      workspaceId,
      kbId: scope.kbId,
      roomCardId: scope.roomCardId,
      layoutJson,
      viewportJson,
    })
    resetSnapshotCache()
  }

  const layoutSaveCoordinator = new SaveCoordinator<GraphMeta>({
    delayMs: 300,
    save: async (roomRef, meta) => {
      await writeLayout(roomRef, meta)
    },
    onError: (error, roomRef) => {
      logger.catch('LocalDbGraph.saveCoordinator', `保存图谱布局失败: ${roomRef}`, error)
    },
  })

  const scheduleGraphSave = async (
    roomRef: string,
    buildMeta: () => GraphMeta,
    onSaved?: (() => void) | undefined,
  ) => {
    layoutSaveCoordinator.touch(roomRef, buildMeta, onSaved)
  }

  const flushGraphSave = async (
    roomRef: string,
    buildMeta: () => GraphMeta,
    onFlush?: (() => void) | undefined,
  ) => {
    await layoutSaveCoordinator.flush(roomRef, buildMeta, onFlush)
  }

  const hasPendingGraphSave = (roomRef: string) => {
    if (!roomRef) {
      return false
    }
    return layoutSaveCoordinator.hasPending(roomRef)
  }

  return {
    readLayout,
    writeLayout,
    scheduleGraphSave,
    flushGraphSave,
    hasPendingGraphSave,
    countChildren,
    listTopoDocuments,
    createCard,
    deleteCard,
    renameCard,
  }
}
