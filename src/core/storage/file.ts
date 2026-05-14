import { FSB } from '../fs-backend'
import type { StorageBackend } from './service'
import type { CardInfo, GraphMeta } from '../../domain/graph/model'
import type { EdgeRelation, EdgeWeight } from '../../types'
import { basenameRef, joinRefs, normalizeRef } from '../../domain/graph/path-utils'

interface FSBGraphChild {
  name: string
  x?: number
  y?: number
  width?: number
  height?: number
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

async function updateCardName(rootDir: string, cardPath: string, newName: string): Promise<void> {
  const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
  const cardId = basenameRef(cardPath)
  const graph = await FSB.readGraphMeta(rootDir, parentPath)
  const children = isRecord(graph.children) ? { ...graph.children } : {}

  const entry = children[cardId]
  if (isRecord(entry)) {
    children[cardId] = { ...entry, name: newName }
    await FSB.writeGraphMeta(rootDir, parentPath, { ...graph, children })
  }
}

export function convertFSBToGraph(raw: FSBGraphLike, roomRef = ''): GraphMeta {
  const children = raw.children ?? {}

  const nodes: GraphMeta['nodes'] = {}
  for (const [key, child] of Object.entries(children)) {
    const ref = normalizeRef(key)
    nodes[ref] = {
      id: ref,
      card: { ref, name: child.name, updatedAt: undefined },
      height: Number.isFinite(child.height) ? child.height as number : 52,
      width: Number.isFinite(child.width) ? child.width as number : 120,
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
    source: { ref: normalizeRef(e.source), name: '', updatedAt: undefined },
    target: { ref: normalizeRef(e.target), name: '', updatedAt: undefined },
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
    const key = ref || basenameRef(node.id) || node.id
    children[key] = {
      name: node.card.name,
      x: node.position?.x,
      y: node.position?.y,
      width: node.width,
      height: node.height,
    }
  }

  return {
    children,
    edges: meta.edges.map(e => ({
      id: e.id,
      source: normalizeRef(e.source.ref),
      target: normalizeRef(e.target.ref),
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

    createKB: async (name: string): Promise<void> => {
      await FSB.createKbsDir(requireRootDir(), name)
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
      const cardPath = await FSB.createCardDir(requireRootDir(), parentPath, name)
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

    readCardMarkdown: async (cardPath: string) => {
      return FSB.readFile(requireRootDir(), `${cardPath}/_card.md`)
    },

    writeCardMarkdown: async (cardPath: string, content: string) => {
      await FSB.writeFile(requireRootDir(), `${cardPath}/_card.md`, content)
    },

    writeAttachmentBase64: async (cardPath: string, fileName: string, mimeType: string, base64: string) => {
      return FSB.writeAttachmentBase64(requireRootDir(), cardPath, fileName, mimeType, base64)
    },

    downloadAttachment: async (cardPath: string, url: string) => {
      return FSB.downloadAttachment(requireRootDir(), cardPath, url)
    },

    readAttachmentDataUrl: async (cardPath: string, attachmentRef: string) => {
      return FSB.readAttachmentDataUrl(requireRootDir(), cardPath, attachmentRef)
    },

    readConfig: () => {
      return FSB.readAppConfig(requireRootDir())
    },

    writeConfig: async (content: unknown) => {
      await FSB.writeAppConfig(requireRootDir(), content)
    },
  }
}
