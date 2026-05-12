import { FSB } from '../fs-backend'
import type { StorageBackend } from './service'
import type { CardInfo, GraphMeta } from '../../domain/graph/model'
import type { EdgeRelation, EdgeWeight } from '../../types'
import { basenameRef, joinRefs, normalizeRef, parentRef, resolveRoomChildRef } from '../../domain/graph/path-utils'

interface FSBGraphChild {
  name: string
  x?: number
  y?: number
}

interface FSBGraphEdge {
  id: string
  source: string
  target: string
  relation?: EdgeRelation
  weight?: EdgeWeight
  lineMode?: 'smoothstep' | 'straight'
  lineStyle?: 'solid' | 'dashed'
  color?: string
  arrow?: boolean
  highlighted?: boolean
  faded?: boolean
}

interface FSBGraphLike {
  edges?: FSBGraphEdge[]
  children?: Record<string, FSBGraphChild>
  zoom?: number | null
  pan?: { x: number; y: number } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const toCardInfo = (parentCardPath: string, key: string, rawChild: unknown): CardInfo => {
  const child = isRecord(rawChild) ? rawChild : {}
  const rawName = child.name
  const childPath = parentCardPath && !key.startsWith(`${parentCardPath}/`)
    ? joinRefs(parentCardPath, key)
    : normalizeRef(key)
  const fallbackName = basenameRef(childPath) || key
  const safeName = (typeof rawName === 'string' && rawName.trim()) ? rawName.trim() : fallbackName

  return {
    ref: childPath,
    name: safeName,
    updatedAt: undefined,
  }
}

function toRoomRelativeRef(roomRef: string, ref: string): string {
  const normalizedRoom = normalizeRef(roomRef)
  const normalizedRef = normalizeRef(ref)
  if (!normalizedRoom || !normalizedRef) return normalizedRef
  if (normalizedRef === normalizedRoom) return ''
  const prefix = `${normalizedRoom}/`
  return normalizedRef.startsWith(prefix) ? normalizedRef.slice(prefix.length) : normalizedRef
}

function fromRoomRelativeRef(roomRef: string, ref: string): string {
  const normalizedRoom = normalizeRef(roomRef)
  const normalizedRef = normalizeRef(ref)
  if (!normalizedRef) return ''
  if (!normalizedRoom) return normalizedRef
  if (normalizedRef === normalizedRoom || normalizedRef.startsWith(`${normalizedRoom}/`)) {
    return normalizedRef
  }

  const roomParent = parentRef(normalizedRoom)
  if (roomParent && (normalizedRef === roomParent || normalizedRef.startsWith(`${roomParent}/`))) {
    return normalizedRef
  }

  const roomName = basenameRef(normalizedRoom)
  if (roomParent && roomName && normalizedRef.startsWith(`${roomName}/`)) {
    return joinRefs(roomParent, normalizedRef)
  }

  return resolveRoomChildRef(normalizedRoom, normalizedRef)
}

function kbRelativeRef(ref: string): string {
  const parts = normalizeRef(ref).split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(1).join('/')
}

function roomRelativeChildRef(parentPath: string, childPath: string): string {
  const parentParts = normalizeRef(parentPath).split('/').filter(Boolean)
  const childParts = normalizeRef(childPath).split('/').filter(Boolean)
  const matchesParent = parentParts.length > 0 && parentParts.every((part, index) => childParts[index] === part)
  if (matchesParent) return childParts.slice(parentParts.length).join('/')
  return childParts.length ? childParts[childParts.length - 1] : ''
}

async function updateCardName(rootDir: string, cardPath: string, newName: string): Promise<void> {
  const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
  const graph = await FSB.readGraphMeta(rootDir, parentPath)
  const children = isRecord(graph.children) ? { ...graph.children } : {}
  const candidateKeys = [
    roomRelativeChildRef(parentPath, cardPath),
    kbRelativeRef(cardPath),
    cardPath,
  ]

  for (const key of candidateKeys) {
    const entry = children[key]
    if (isRecord(entry)) {
      children[key] = { ...entry, name: newName }
      await FSB.writeGraphMeta(rootDir, parentPath, { ...graph, children })
      return
    }
  }
}

export function convertFSBToGraph(raw: FSBGraphLike, roomRef = ''): GraphMeta {
  const children = raw.children ?? {}

  const nodes: GraphMeta['nodes'] = {}
  for (const [key, child] of Object.entries(children)) {
    const ref = fromRoomRelativeRef(roomRef, key)
    nodes[ref] = {
      id: ref,
      card: { ref, name: child.name, updatedAt: undefined },
      height: 150,
      width: 200,
      position: Number.isFinite(child.x) && Number.isFinite(child.y)
        ? { x: child.x as number, y: child.y as number }
        : undefined,
    }
  }

  const edges: Array<{
    id: string; source: CardInfo; target: CardInfo; relation: EdgeRelation; weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'
    color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean
  }> = (raw.edges ?? []).map(e => ({
    id: e.id,
    source: { ref: fromRoomRelativeRef(roomRef, e.source), name: '', updatedAt: undefined },
    target: { ref: fromRoomRelativeRef(roomRef, e.target), name: '', updatedAt: undefined },
    relation: e.relation ?? '相关',
    weight: e.weight ?? 'minor',
    lineMode: e.lineMode,
    lineStyle: e.lineStyle,
    color: e.color,
    arrow: e.arrow,
    highlighted: e.highlighted,
    faded: e.faded,
  }))

  return {
    nodes,
    edges,
    viewport: {
      zoom: (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) ? raw.zoom : 1,
      pan: (raw.pan && typeof raw.pan === 'object' && Number.isFinite(raw.pan.x) && Number.isFinite(raw.pan.y))
        ? raw.pan
        : { x: 0, y: 0 },
    },
  }
}

export function convertGraphToFSB(meta: GraphMeta, roomRef = ''): {
  children?: Record<string, FSBGraphChild>
  edges?: Array<{
    id: string; source: string; target: string; relation: EdgeRelation; weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'
    color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean
  }>
  zoom?: number; pan?: { x: number; y: number }
} {
  const children: Record<string, FSBGraphChild> = {}
  for (const node of Object.values(meta.nodes)) {
    const ref = normalizeRef(node.card?.ref || node.id)
    const key = toRoomRelativeRef(roomRef, ref) || basenameRef(ref) || basenameRef(node.id) || node.id
    children[key] = {
      name: node.card.name,
      x: node.position?.x,
      y: node.position?.y,
    }
  }

  return {
    children,
    edges: meta.edges.map(e => ({
      id: e.id,
      source: toRoomRelativeRef(roomRef, e.source.ref),
      target: toRoomRelativeRef(roomRef, e.target.ref),
      relation: e.relation,
      weight: e.weight,
      lineMode: e.lineMode,
      lineStyle: e.lineStyle,
      color: e.color,
      arrow: e.arrow,
      highlighted: e.highlighted,
      faded: e.faded,
    })),
    zoom: meta.viewport.zoom,
    pan: meta.viewport.pan,
  }
}

export function createFileStorageBackend(getRootDir: () => string | null): StorageBackend {
  const requireRootDir = () => {
    const rootDir = getRootDir()
    if (!rootDir) throw new Error('未选择工作目录')
    return rootDir
  }

  return {
    createVault: async (dirPath: string): Promise<void> => {
      const result = await FSB.createWorkDir(dirPath)
      if (!result.valid) {
        throw new Error(result.error || '创建工作目录失败')
      }
    },

    isValidVault: async (dirPath: string) => {
      try {
        const result = await FSB.isValidWorkDir(dirPath)
        return { valid: result.valid, error: result.error }
      } catch {
        return { valid: false, error: '工作目录校验失败' }
      }
    },

    listKBs: async () => {
      return FSB.listKBs(requireRootDir())
    },

    createKB: async (name: string): Promise<string> => {
      return FSB.createKbsDir(requireRootDir(), name)
    },

    deleteKB: async (kbPath: string): Promise<void> => {
      await FSB.deleteKbsDir(requireRootDir(), kbPath)
    },

    renameKB: async (kbPath: string, newName: string): Promise<void> => {
      await FSB.renameKB(requireRootDir(), kbPath, newName)
    },

    importKB: async (sourcePath: string): Promise<string> => {
      return FSB.importKB(requireRootDir(), sourcePath)
    },

    listCards: async (parentCardPath: string): Promise<CardInfo[]> => {
      const children = await FSB.readCardChildren(requireRootDir(), parentCardPath)
      return Object.entries(children)
        .map(([key, child]) => toCardInfo(parentCardPath, key, child))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
    },

    createCard: async (parentPath: string, name: string): Promise<CardInfo> => {
      const cardPath = await FSB.createKbsDir(requireRootDir(), joinRefs(parentPath, name))
      return { ref: cardPath, name, updatedAt: undefined }
    },

    deleteCard: async (cardPath: string): Promise<void> => {
      await FSB.deleteKbsDir(requireRootDir(), cardPath)
    },

    renameCard: async (cardPath: string, newName: string): Promise<void> => {
      await updateCardName(requireRootDir(), cardPath, newName)
    },

    readLayout: async (roomPath: string): Promise<GraphMeta> => {
      try {
        const raw = await FSB.readGraphMeta(requireRootDir(), roomPath)
        return convertFSBToGraph(
          raw as Parameters<typeof convertFSBToGraph>[0], 
          roomPath
        )
      } catch {
        return { nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }
      }
    },

    writeLayout: async (roomPath: string, meta: GraphMeta): Promise<void> => {
      await FSB.writeGraphMeta(requireRootDir(), roomPath, convertGraphToFSB(meta, roomPath) as Parameters<typeof FSB.writeGraphMeta>[2])
    },

    readMarkdown: async (cardPath: string) => {
      return FSB.readFile(requireRootDir(), `${cardPath}/_content.md`)
    },

    writeMarkdown: async (cardPath: string, content: string) => {
      await FSB.writeFile(requireRootDir(), `${cardPath}/_content.md`, content)
    },

    readConfig: () => {
      return FSB.readAppConfig(requireRootDir())
    },

    writeConfig: async (content: unknown) => {
      await FSB.writeAppConfig(requireRootDir(), content)
    },
  }
}
