import { FSB } from '../../fs-backend'
import type { CardInfo, GraphMeta, KBInfo, StorageAdapter, VaultInfo } from '../adapter'
import type { VaultRef } from '../adapter/vault'
import type { KBRef } from '../adapter/kb'
import type { CardRef } from '../adapter/card'
import type { EdgeRelation, EdgeWeight } from '../../../types'

const toKBInfo = (child: { path: string; name: string; order?: number }, vaultRef: VaultRef): KBInfo => ({
  ref: child.path,
  name: child.name,
  coverRef: null,
})

const toCardInfo = (child: { path: string; name: string }, kbRef: KBRef): CardInfo => ({
  ref: child.path,
  name: child.name,
  updatedAt: undefined,
})

/**
 * Convert old FSBGraphMeta format (string refs in edges) to new GraphMeta format (CardInfo objects).
 */
function convertFSBToGraph(raw: {
  edges?: Array<{
    id: string; source: string; target: string; relation?: EdgeRelation; weight?: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'
    color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean
  }>
  children?: Record<string, { name: string; hasChildren?: boolean }>
  zoom?: number | null; pan?: { x: number; y: number } | null
}): GraphMeta {
  const children = raw.children ?? {}

  const nodes: Record<string, { id: string; card: CardInfo; height: number; width: number }> = {}
  for (const [path, child] of Object.entries(children)) {
    nodes[path] = {
      id: path,
      card: { ref: path, name: child.name, updatedAt: undefined },
      height: 150,
      width: 200,
    }
  }

  const edges: Array<{
    id: string; source: CardInfo; target: CardInfo; relation: EdgeRelation; weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'
    color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean
  }> = (raw.edges ?? []).map(e => ({
    id: e.id,
    source: { ref: e.source, name: '', updatedAt: undefined },
    target: { ref: e.target, name: '', updatedAt: undefined },
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

/**
 * Convert new GraphMeta format (CardInfo objects in edges) to old FSBGraphMeta format (string refs).
 */
function convertGraphToFSB(meta: GraphMeta): {
  children?: Record<string, { name: string; hasChildren?: boolean }>
  edges?: Array<{
    id: string; source: string; target: string; relation: EdgeRelation; weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'
    color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean
  }>
  zoom?: number; pan?: { x: number; y: number }
} {
  const children: Record<string, { name: string; hasChildren?: boolean }> = {}
  for (const node of Object.values(meta.nodes)) {
    const name = node.id.includes('/') || node.id.includes('\\')
      ? (node.id.split(/[/\\]/).pop() ?? node.id)
      : node.id
    children[name] = { name: node.card.name, hasChildren: false }
  }

  return {
    children,
    edges: meta.edges.map(e => ({
      id: e.id,
      source: e.source.ref,
      target: e.target.ref,
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

export function createFileStorageAdapter(getRootDir: () => string | null): StorageAdapter {
  const requireRootDir = () => {
    const rootDir = getRootDir()
    if (!rootDir) throw new Error('未选择工作目录')
    return rootDir
  }

  return {
    // ===== Core StorageAdapter (IVaultStorage) =====

    createVault: async (vaultRef: VaultRef): Promise<VaultInfo> => {
      await FSB.createWorkDir(vaultRef)
      return { ref: vaultRef }
    },

    isValidVault: async (vaultRef: VaultRef) => {
      try {
        const result = await FSB.isValidWorkDir(vaultRef)
        return { valid: result.valid, error: result.error }
      } catch {
        return { valid: false, error: '工作目录校验失败' }
      }
    },

    getVaultInfo: async (vaultRef: VaultRef): Promise<VaultInfo> => {
      return { ref: vaultRef }
    },

    removeVault: async (vaultRef: VaultRef): Promise<void> => {
      await FSB.rmDir(requireRootDir(), vaultRef)
    },

    // ===== Core StorageAdapter (IKBSStorage) =====

    listKBS: async (vaultRef: VaultRef): Promise<KBInfo[]> => {
      const children = await FSB.listChildren(requireRootDir(), vaultRef)
      return children.map(c => toKBInfo(c, vaultRef))
    },

    createKB: async (vaultRef: VaultRef, name: string): Promise<KBInfo> => {
      const kbPath = await FSB.mkDir(requireRootDir(), name, null)
      return { ref: kbPath, name, coverRef: null }
    },

    deleteKB: async (kbInfo: KBInfo): Promise<void> => {
      await FSB.rmDir(requireRootDir(), kbInfo.ref)
    },

    renameKB: async (kbInfo: KBInfo, newName: string): Promise<void> => {
      await FSB.renameKB(requireRootDir(), kbInfo.ref, newName)
    },

    importKB: async (targetVaultRef: VaultRef, sourceKBInfo: KBInfo): Promise<KBInfo> => {
      const importedPath = await FSB.importKB(requireRootDir(), sourceKBInfo.ref)
      const parts = importedPath.split('/')
      const name = parts[parts.length - 1]
      return { ref: importedPath, name, coverRef: null }
    },

    // ===== Core StorageAdapter (ICardStorage) =====

    listCards: async (kbRef: KBRef): Promise<CardInfo[]> => {
      const children = await FSB.listChildren(requireRootDir(), kbRef)
      return children.map(c => toCardInfo(c, kbRef))
    },

    createCard: async (kbRef: KBRef, name: string): Promise<CardInfo> => {
      const cardPath = await FSB.mkDir(requireRootDir(), `${kbRef}/${name}`, null)
      return { ref: cardPath, name, updatedAt: undefined }
    },

    deleteCard: async (cardRef: CardRef): Promise<void> => {
      await FSB.rmDir(requireRootDir(), cardRef)
    },

    renameCard: async (cardRef: CardRef, newName: string): Promise<void> => {
      await FSB.updateCardMeta(requireRootDir(), cardRef, newName)
    },

    countSubCards: async (cardRef: CardRef): Promise<number> => {
      return FSB.countChildren(requireRootDir(), cardRef)
    },

    // ===== Core StorageAdapter (IGraphStorage) =====

    readCardLayout: async (kbRef: KBRef): Promise<GraphMeta> => {
      try {
        const raw = await FSB.readGraphMeta(requireRootDir(), kbRef)
        return convertFSBToGraph(raw as Parameters<typeof convertFSBToGraph>[0])
      } catch {
        return { nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }
      }
    },

    writeCardLayout: async (kbRef: KBRef, meta: GraphMeta): Promise<void> => {
      await FSB.writeGraphMeta(requireRootDir(), kbRef, convertGraphToFSB(meta) as Parameters<typeof FSB.writeGraphMeta>[2])
    },

    // ===== Core StorageAdapter (ICardStorage): Markdown operations =====

    readCardMarkdown: async (cardPath: string) => {
      return FSB.readFile(requireRootDir(), `${cardPath}/_content.md`)
    },

    writeCardMarkdown: async (cardPath: string, content: string) => {
      await FSB.writeFile(requireRootDir(), `${cardPath}/_content.md`, content)
    },

    // ===== Core StorageAdapter (IVaultStorage): App config =====

    readAppConfig: () => {
      return FSB.readAppConfig(requireRootDir())
    },

    writeAppConfig: async (content: unknown) => {
      await FSB.writeAppConfig(requireRootDir(), content)
    },
  }
}
