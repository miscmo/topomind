import type { EdgeRelation, EdgeWeight } from '../../types'

/**
 * 存储实体引用。
 *
 * 当前 Electron 文件系统实现中 ref 的值仍然是相对路径；未来切换 SQLite / Remote API 时，
 * ref 可以自然映射为数据库 id、uuid 或服务端资源 id。Store/UI 不应该假设它一定是文件路径。
 */
export type StorageRef = string
export type WorkspaceRef = StorageRef
export type KBRef = StorageRef
export type CardRef = StorageRef

/** 工作区信息 */
export interface WorkspaceInfo {
  ref: WorkspaceRef
  createdAt?: string
  updatedAt?: string
}

export interface StorageDialogResult {
  valid: boolean
  nodePath?: string | null
  path?: string
  error?: string
}

/** 知识库信息 */
export interface KBInfo {
  ref: KBRef
  path: string
  name: string
  order: number
  coverRef?: StorageRef | null
  childCount?: number
  lastOpenedAt?: string
}

/** 卡片信息 */
export interface CardInfo {
  ref: CardRef
  path: string
  name: string
  parentRef?: CardRef | null
  order?: number
  hasChildren: boolean
  childCount?: number
  isDir?: boolean
  updatedAt?: string
}

export interface StorageChildInfo {
  ref: StorageRef
  path: string
  name: string
  isDir: boolean
  order?: number
}

export interface StorageGraphMeta {
  children?: Record<string, StorageChildInfo>
  edges?: Array<{
    id: string
    source: StorageRef
    target: StorageRef
    relation: EdgeRelation
    weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight'
    lineStyle?: 'solid' | 'dashed'
    color?: string
    arrow?: boolean
    highlighted?: boolean
    faded?: boolean
  }>
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

export interface IWorkspaceStorage {
  initWorkspace: () => Promise<unknown>
  setWorkspace: (rootRef: StorageRef) => Promise<StorageDialogResult>
  selectWorkspaceCandidate: () => Promise<StorageDialogResult>
  createWorkspace: (rootRef: StorageRef) => Promise<StorageDialogResult>
  getWorkspaceRoot: () => Promise<StorageRef | null>
  clearWorkspace: () => Promise<unknown>
}

export interface IKBSStorage {
  listKnowledgeBases: () => Promise<KBInfo[]>
  createKnowledgeBase: (name: string, meta?: object | null) => Promise<KBRef>
  deleteKnowledgeBase: (kbRef: KBRef) => Promise<unknown>
  renameKnowledgeBase: (kbRef: KBRef, newName: string) => Promise<KBRef>
  setKnowledgeBaseOrder: (kbRef: KBRef, order: number) => Promise<unknown>
  saveKnowledgeBaseCover: (kbRef: KBRef, coverRef: StorageRef | null) => Promise<unknown>
  importKnowledgeBase: (sourceRef: StorageRef) => Promise<KBRef>
  getLastOpenedKnowledgeBase: () => Promise<KBRef | null>
  setLastOpenedKnowledgeBase: (kbRef: KBRef | null) => Promise<unknown>
}

export interface ICardStorage {
  listCards: (parentCardRef: CardRef) => Promise<CardInfo[]>
  createCard: (cardRef: CardRef, meta?: object | null) => Promise<CardRef>
  deleteCard: (cardRef: CardRef) => Promise<unknown>
  renameCard: (cardRef: CardRef, newName: string) => Promise<CardRef>
  ensureCard: (cardRef: CardRef) => Promise<unknown>
  countCards: (parentCardRef: CardRef) => Promise<number>
  openCardLocation: (cardRef: CardRef) => Promise<unknown>
}

export interface IDocumentStorage {
  readCardMarkdown: (cardRef: CardRef) => Promise<string>
  writeCardMarkdown: (cardRef: CardRef, content: string) => Promise<unknown>
}

export interface IGraphStorage {
  readCardLayout: (cardRef: CardRef) => Promise<StorageGraphMeta>
  writeCardLayout: (cardRef: CardRef, meta: StorageGraphMeta) => Promise<unknown>
}

export interface IAssetStorage {
  writeCardAsset: (assetRef: StorageRef, buffer: ArrayBuffer) => Promise<unknown>
  readCardAsset: (assetRef: StorageRef) => Promise<ArrayBuffer | null>
}

export interface IConfigStorage {
  readAppConfig: () => Promise<unknown>
  writeAppConfig: (content: unknown) => Promise<unknown>
}

export type StorageAdapter =
  & IWorkspaceStorage
  & IKBSStorage
  & ICardStorage
  & IDocumentStorage
  & IGraphStorage
  & IAssetStorage
  & IConfigStorage
