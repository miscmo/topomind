import { FSB } from '../fs-backend'
import type { CardInfo, GraphMeta, StorageBackend } from './types'
import type { EdgeRelation, EdgeWeight } from '../../types'
import { basenameRef, joinRefs, normalizeRef, parentRef, resolveRoomChildRef } from '../../domain/graph/path-utils'

interface FSBGraphChild {
  path?: string
  name: string
  hasChildren?: boolean
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

const toCardInfo = (child: { path: string; name: string }): CardInfo => ({
  ref: child.path,
  name: child.name,
  updatedAt: undefined,
})

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

export function convertFSBToGraph(raw: FSBGraphLike, roomRef = ''): GraphMeta {
  const children = raw.children ?? {}

  const nodes: GraphMeta['nodes'] = {}
  for (const [key, child] of Object.entries(children)) {
    const ref = fromRoomRelativeRef(roomRef, child.path || key)
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
      path: key || undefined,
      name: node.card.name,
      hasChildren: false,
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

    removeVault: async (dirPath: string): Promise<void> => {
      await FSB.deleteKB(requireRootDir(), dirPath)
    },

    listKBs: async () => {
      return FSB.listKBs(requireRootDir())
    },

    createKB: async (name: string): Promise<string> => {
      return FSB.createKB(requireRootDir(), name)
    },

    deleteKB: async (kbPath: string): Promise<void> => {
      await FSB.deleteKB(requireRootDir(), kbPath)
    },

    renameKB: async (kbPath: string, newName: string): Promise<void> => {
      await FSB.renameKB(requireRootDir(), kbPath, newName)
    },

    importKB: async (sourcePath: string): Promise<string> => {
      return FSB.importKB(requireRootDir(), sourcePath)
    },

    listCards: async (parentPath: string): Promise<CardInfo[]> => {
      const children = await FSB.listCards(requireRootDir(), parentPath)
      return children.map(c => toCardInfo(c))
    },

    createCard: async (parentPath: string, name: string): Promise<CardInfo> => {
      const cardPath = await FSB.createCard(requireRootDir(), parentPath, name)
      return { ref: cardPath, name, updatedAt: undefined }
    },

    deleteCard: async (cardPath: string): Promise<void> => {
      await FSB.deleteCard(requireRootDir(), cardPath)
    },

    renameCard: async (cardPath: string, newName: string): Promise<void> => {
      await FSB.updateCardMeta(requireRootDir(), cardPath, newName)
    },

    countChildren: async (cardPath: string): Promise<number> => {
      return FSB.countChildren(requireRootDir(), cardPath)
    },

    readLayout: async (roomPath: string): Promise<GraphMeta> => {
      try {
        const raw = await FSB.readGraphMeta(requireRootDir(), roomPath)
        return convertFSBToGraph(raw as Parameters<typeof convertFSBToGraph>[0], roomPath)
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
