import type { EdgeRelation, EdgeWeight, KBListItem } from '../../types'

export interface CardInfo {
  ref: string
  name: string
  updatedAt?: string
}

interface KBNode {
  id: string
  card: CardInfo
  height: number
  width: number
  position?: { x: number; y: number }
}

export interface KBEdge {
  id: string
  source: CardInfo
  target: CardInfo
  relation: EdgeRelation
  weight: EdgeWeight
  lineMode?: 'smoothstep' | 'straight'
  lineStyle?: 'solid' | 'dashed'
  color?: string
  arrow?: boolean
  highlighted?: boolean
  faded?: boolean
}

interface KBViewport {
  zoom: number
  pan: { x: number; y: number }
}

export interface GraphMeta {
  nodes: Record<string, KBNode>
  edges: KBEdge[]
  viewport: KBViewport
}

export interface StorageBackend {
  createVault: (dirPath: string) => Promise<void>
  isValidVault: (dirPath: string) => Promise<{ valid: boolean; error?: string }>
  removeVault: (dirPath: string) => Promise<void>

  listKBs: () => Promise<KBListItem[]>
  createKB: (name: string) => Promise<string>
  deleteKB: (kbPath: string) => Promise<void>
  renameKB: (kbPath: string, newName: string) => Promise<void>
  importKB: (sourcePath: string) => Promise<string>

  listCards: (parentPath: string) => Promise<CardInfo[]>
  createCard: (parentPath: string, name: string) => Promise<CardInfo>
  deleteCard: (cardPath: string) => Promise<void>
  renameCard: (cardPath: string, newName: string) => Promise<void>
  countChildren: (cardPath: string) => Promise<number>

  readMarkdown: (cardPath: string) => Promise<string>
  writeMarkdown: (cardPath: string, content: string) => Promise<void>

  readLayout: (roomPath: string) => Promise<GraphMeta>
  writeLayout: (roomPath: string, meta: GraphMeta) => Promise<void>

  readConfig: () => Promise<unknown>
  writeConfig: (content: unknown) => Promise<void>
}
