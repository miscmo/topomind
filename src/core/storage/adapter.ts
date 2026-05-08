import type { EdgeRelation, EdgeWeight } from '../../types'

/**
 * 存储实体引用。
 *
 * 当前 Electron 文件系统实现中 ref 的值仍然是相对路径；未来切换 SQLite / Remote API 时，
 * ref 可以自然映射为数据库 id、uuid 或服务端资源 id。Store/UI 不应该假设它一定是文件路径。
 */
export type StorageRef = string
export type VaultRef = StorageRef
export type KBRef = StorageRef
export type CardRef = StorageRef

/** 资料库信息 */
export interface VaultInfo {
  ref: VaultRef
  createdAt?: string
  updatedAt?: string
}

/** 知识库信息 */
export interface KBInfo {
  ref: KBRef
  vaultRef: VaultRef
  name: string
  coverRef?: string | null
  childCount?: number
}

/** 卡片信息 */
export interface CardInfo {
  ref: CardRef
  kbRef: KBRef
  name: string
  updatedAt?: string
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

export interface IVaultStorage {
  /** 
   * 创建资料库 
   * @param rootRef 资料库根路径
   * @returns 结果
  */
  createVault: (rootRef: StorageRef) => Promise<StorageDialogResult>

  /** 
   * 验证资料库是否有效 
   * @param rootRef 资料库根路径
   * @returns 是否有效
   */
  isVaildVault: (rootRef: StorageRef) => Promise<boolean>

  /**
   * 获取资料库信息
   * @param vaultRef 资料库引用
   * @returns 
   */
  getVaultInfo: (vaultRef: VaultRef) => Promise<VaultInfo>

  /**
   * 删除资料库
   * @param vaultRef 资料库引用
   * @returns 结果
   */
  removeVault: (vaultRef: VaultRef) => Promise<unknown>
}

export interface IKBSStorage {
  /**
   * 获取知识库列表
   * @param vaultRef 资料库引用
   * @returns 知识库列表
   */
  listKBS: (vaultRef: VaultRef) => Promise<KBInfo[]>

  /**
   * 创建知识库
   * @param vaultRef 资料库引用
   * @param name 知识库名称
   * @param meta 知识库元数据
   * @returns 知识库引用
   */
  createKB: (vaultRef: VaultRef, name: string, meta?: object | null) => Promise<KBRef>

  /**
   * 删除知识库
   * @param kbRef 知识库引用
   * @returns 结果
   */
  deleteKB: (kbRef: KBRef) => Promise<unknown>

  /**
   * 重命名知识库
   * @param kbRef 知识库引用
   * @param newName 新名称
   * @returns 知识库引用
   */
  renameKB: (kbRef: KBRef, newName: string) => Promise<KBRef>

  /**
   * 设置知识库封面
   * @param kbRef 知识库引用
   * @param coverRef 封面引用
   * @returns 结果
   */
  setKBCover: (kbRef: KBRef, coverRef: StorageRef | null) => Promise<unknown>

  /**
   * 导入知识库
   * @param targetVaultRef 目标资料库引用
   * @param sourceKBRef 源知识库引用
   * @returns 知识库引用
   */
  importKB: (targetVaultRef: VaultRef, sourceKBRef: KBRef) => Promise<KBRef>
}

export interface ICardStorage {
  /**
   * 获取知识卡片列表
   * @param parentCardRef 父卡片引用
   * @returns 卡片列表
   */
  listCards: (kbRef: KBRef) => Promise<CardInfo[]>

  /**
   * 获取知识卡片信息
   * @param cardRef 知识卡片引用
   * @returns 卡片信息
   */
  GetCardInfo: (cardRef: CardRef) => Promise<CardInfo>

  /**
   * 创建知识卡片
   * @param parentCardRef 父卡片引用
   * @param meta 
   * @returns 
   */
  createCard: (cardRef: CardRef, meta?: object | null) => Promise<CardRef>


  /**
   * 删除知识卡片
   * @param cardRef 知识卡片引用
   * @returns 结果
   */
  deleteCard: (cardRef: CardRef) => Promise<unknown>

  /**
   * 重命名知识卡片
   * @param cardRef 知识卡片引用
   * @param newName 新名称
   * @returns 
   */
  renameCard: (cardRef: CardRef, newName: string) => Promise<CardRef>

  /**
   * 获取子卡片数量
   * @param parentCardRef 父卡片引用
   * @returns 子卡片数量
   */
  countSubCards: (cardRef: CardRef) => Promise<number>
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

export interface ILogStorage {
  readLogs: () => Promise<unknown>
  writeLogs: (content: unknown) => Promise<unknown>
}

export type StorageAdapter =
  & IVaultStorage
  & IKBSStorage
  & ICardStorage
  & IDocumentStorage
  & IGraphStorage
  & IAssetStorage
  & IConfigStorage
  & ILogStorage