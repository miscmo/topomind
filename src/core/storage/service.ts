/**
 * 统一存储服务。
 * 业务层通过 useStorage() 调用，底层存储由 StorageBackend 隔离。
 */
import { logger } from '../logger'
import type { KBListItem } from '../../types'
import type { CardInfo, GraphMeta } from '../../domain/graph/model'
import { SaveCoordinator } from '../../domain/persistence/saveCoordinator'
import { normalizeGraphMeta } from '../../domain/graph/normalizeGraphMeta'

interface VaultConfig {
  edgeDefaultsVersion?: number
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  defaultNodeStyle?: {
    headerFontSize?: number
    bodyFontSize?: number
    headerColor?: string
    headerBackgroundColor?: string
    headerFontWeight?: 'normal' | 'bold'
    headerFontStyle?: 'normal' | 'italic'
    borderColor?: string
    borderWidth?: number
    borderRadius?: number
  }
  defaultNodeSize?: { width?: number; height?: number }
  defaultEditorStyle?: {
    fontSize?: number
    fontFamily?: string
    backgroundColor?: string
    textColor?: string
    lineHeight?: number
  }
  nodeSizeLimits?: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }
  nodeBadgeSize?: number
  kbCovers?: Record<string, string>
  kbCoverOffsets?: Record<string, number>
  kbOrder?: string[]
  [key: string]: unknown
}

export type TopoDocumentType = 'markdown' | 'smart' | 'mindmap' | 'flowchart'

export interface TopoDocumentManifestItem {
  id: string
  type: TopoDocumentType
  title: string
  path: string
  parentId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  version: number
}

export interface TopoDocumentManifest {
  version: 2
  documents: Record<string, TopoDocumentManifestItem>
}

export interface TopoDocumentCreateInput {
  type: TopoDocumentType
  title: string
  parentId?: string | null
}

export interface TopoDocumentRepairResult {
  repaired: boolean
  corrupted: boolean
  added: number
  removed: number
  documents: TopoDocumentManifestItem[]
}

export interface TopoDocumentExportPayload {
  fileName: string
  type: TopoDocumentType
  mimeType: string
  content: string
}

export interface StorageBackend {
  createVault: (dirPath: string) => Promise<void>
  isValidVault: (dirPath: string) => Promise<{ valid: boolean; error?: string }>

  listKBs: () => Promise<KBListItem[]>
  createKB: (name: string) => Promise<void>
  deleteKB: (kbPath: string) => Promise<void>
  renameKB: (kbPath: string, newName: string) => Promise<void>
  importKB: (sourcePath: string) => Promise<string>

  listCards: (parentCardPath: string) => Promise<CardInfo[]>
  createCard: (parentPath: string, name: string) => Promise<CardInfo>
  deleteCard: (cardPath: string) => Promise<void>
  renameCard: (cardPath: string, newName: string) => Promise<void>

  listTopoDocuments: (cardPath: string) => Promise<TopoDocumentManifestItem[]>
  createTopoDocument: (cardPath: string, input: TopoDocumentCreateInput) => Promise<TopoDocumentManifestItem>
  readTopoDocument: (cardPath: string, documentId: string) => Promise<unknown>
  writeTopoDocument: (cardPath: string, documentId: string, content: unknown) => Promise<void>
  renameTopoDocument: (cardPath: string, documentId: string, title: string) => Promise<TopoDocumentManifestItem>
  deleteTopoDocument: (cardPath: string, documentId: string) => Promise<void>
  moveTopoDocument: (cardPath: string, documentId: string, newParentId: string | null, newSortOrder: number) => Promise<TopoDocumentManifestItem>
  repairTopoDocuments: (cardPath: string) => Promise<TopoDocumentRepairResult>
  exportTopoDocument: (cardPath: string, documentId: string) => Promise<TopoDocumentExportPayload>
  openTopoDocumentFolder: (cardPath: string, documentId: string) => Promise<boolean>
  
  listAttachments: (cardPath: string) => Promise<AttachmentItem[]>
  importAttachment: (cardPath: string, sourceFilePath: string, targetFileName?: string) => Promise<string>
  deleteAttachment: (cardPath: string, attachmentName: string) => Promise<void>
  openAttachment: (cardPath: string, attachmentRef: string) => Promise<boolean>
  getAttachmentAbsoluteUrl: (cardPath: string, attachmentRef: string) => Promise<string | null>
  
  writeAttachmentBase64: (cardPath: string, fileName: string, mimeType: string, base64: string) => Promise<string>
  downloadAttachment: (cardPath: string, url: string, targetFileName?: string) => Promise<string>
  readAttachmentDataUrl: (cardPath: string, attachmentRef: string) => Promise<string>

  readLayout: (roomPath: string) => Promise<GraphMeta>
  writeLayout: (roomPath: string, meta: GraphMeta) => Promise<void>

  readConfig: () => Promise<unknown>
  writeConfig: (content: unknown) => Promise<void>
}

function normalizeName(name: unknown): string { return String(name || '').trim() }
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
function normalizeConfig(configRaw: unknown): VaultConfig {
  const c = (configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)) ? configRaw as Record<string, unknown> : {}
  const s = (c.defaultEdgeStyle && typeof c.defaultEdgeStyle === 'object' && !Array.isArray(c.defaultEdgeStyle)) ? c.defaultEdgeStyle as Record<string, unknown> : {}
  const ns = (c.defaultNodeStyle && typeof c.defaultNodeStyle === 'object' && !Array.isArray(c.defaultNodeStyle)) ? c.defaultNodeStyle as Record<string, unknown> : {}
  const defaultNodeSize = (c.defaultNodeSize && typeof c.defaultNodeSize === 'object' && !Array.isArray(c.defaultNodeSize)) ? c.defaultNodeSize as Record<string, unknown> : {}
  const defaultEditorStyle = (c.defaultEditorStyle && typeof c.defaultEditorStyle === 'object' && !Array.isArray(c.defaultEditorStyle)) ? c.defaultEditorStyle as Record<string, unknown> : {}
  const limits = (c.nodeSizeLimits && typeof c.nodeSizeLimits === 'object' && !Array.isArray(c.nodeSizeLimits)) ? c.nodeSizeLimits as Record<string, unknown> : {}
  const edgeDefaultsVersion = c.edgeDefaultsVersion === 2 ? 2 : undefined
  
  const covers = (c.kbCovers && typeof c.kbCovers === 'object' && !Array.isArray(c.kbCovers)) ? c.kbCovers as Record<string, unknown> : {}
  const kbCovers: Record<string, string> = {}
  for (const [k, v] of Object.entries(covers)) {
    if (typeof v === 'string') kbCovers[k] = v
  }

  const offsets = (c.kbCoverOffsets && typeof c.kbCoverOffsets === 'object' && !Array.isArray(c.kbCoverOffsets)) ? c.kbCoverOffsets as Record<string, unknown> : {}
  const kbCoverOffsets: Record<string, number> = {}
  for (const [k, v] of Object.entries(offsets)) {
    if (typeof v === 'number') kbCoverOffsets[k] = v
  }

  const kbOrder = Array.isArray(c.kbOrder) ? c.kbOrder.filter(item => typeof item === 'string') : undefined
  const minWidth = Math.max(1, finiteNumber(limits.minWidth, 120))
  const minHeight = Math.max(1, finiteNumber(limits.minHeight, 52))
  const maxWidth = Math.max(minWidth, finiteNumber(limits.maxWidth, 640))
  const maxHeight = Math.max(minHeight, finiteNumber(limits.maxHeight, 480))

  return {
    edgeDefaultsVersion: 2,
    defaultEdgeStyle: {
      lineMode: edgeDefaultsVersion === 2 && s.lineMode === 'smoothstep' ? 'smoothstep' : 'straight',
      lineStyle: s.lineStyle === 'dashed' ? 'dashed' : 'solid',
      color: typeof s.color === 'string' ? s.color : '#7f8c8d',
      arrow: edgeDefaultsVersion === 2 && typeof s.arrow === 'boolean' ? s.arrow : true,
    },
    defaultNodeStyle: {
      headerFontSize: clampNumber(finiteNumber(ns.headerFontSize, 11), 8, 28),
      bodyFontSize: clampNumber(finiteNumber(ns.bodyFontSize, 12), 8, 24),
      headerColor: typeof ns.headerColor === 'string' ? ns.headerColor : '#475569',
      headerBackgroundColor: typeof ns.headerBackgroundColor === 'string' ? ns.headerBackgroundColor : '#f8fafc',
      headerFontWeight: ns.headerFontWeight === 'bold' ? 'bold' : 'normal',
      headerFontStyle: ns.headerFontStyle === 'italic' ? 'italic' : 'normal',
      borderColor: typeof ns.borderColor === 'string' ? ns.borderColor : '#e2e8f0',
      borderWidth: clampNumber(finiteNumber(ns.borderWidth, 1), 0, 8),
      borderRadius: clampNumber(finiteNumber(ns.borderRadius, 8), 0, 32),
    },
    defaultNodeSize: {
      width: clampNumber(finiteNumber(defaultNodeSize.width, 120), minWidth, maxWidth),
      height: clampNumber(finiteNumber(defaultNodeSize.height, 52), minHeight, maxHeight),
    },
    defaultEditorStyle: {
      fontSize: clampNumber(finiteNumber(defaultEditorStyle.fontSize, 16), 10, 36),
      fontFamily: typeof defaultEditorStyle.fontFamily === 'string' ? defaultEditorStyle.fontFamily : 'inherit',
      backgroundColor: typeof defaultEditorStyle.backgroundColor === 'string' ? defaultEditorStyle.backgroundColor : '#ffffff',
      textColor: typeof defaultEditorStyle.textColor === 'string' ? defaultEditorStyle.textColor : '#333333',
      lineHeight: clampNumber(finiteNumber(defaultEditorStyle.lineHeight, 1.5), 1, 3),
    },
    nodeSizeLimits: {
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
    },
    nodeBadgeSize: clampNumber(finiteNumber(c.nodeBadgeSize, 14), 8, 28),
    kbCovers,
    kbCoverOffsets,
    kbOrder,
  }
}
function ensureValidName(name: unknown, label = '名称'): string {
  const n = normalizeName(name)
  if (!n) throw new Error(`${label}不能为空`)
  if (n === '.' || n === '..') throw new Error(`${label}不合法`)
  return n
}
function ensureValidTopoDocumentType(type: unknown): TopoDocumentType {
  if (type === 'markdown' || type === 'smart' || type === 'mindmap' || type === 'flowchart') return type
  throw new Error(`不支持的文档类型: ${String(type || '')}`)
}


export function createStore(backend: StorageBackend) {
  const layoutSaveCoordinator = new SaveCoordinator<GraphMeta>({
    delayMs: 300,
    save: async (kbPath, meta) => {
      await backend.writeLayout(kbPath, normalizeGraphMeta(meta))
    },
    onError: (error, kbPath) => {
      logger.catch('Store.saveCoordinator', `保存布局失败: ${kbPath}`, error)
    },
  })
  let cachedConfig: VaultConfig = normalizeConfig({})
  let cachedConfigTimestamp = 0
  const CONFIG_CACHE_TTL = 30000

  const store = {
    async init() {
      try {
        await backend.readConfig()
        return { valid: true }
      } catch (e) { logger.catch('Store.init', '初始化 Vault 失败', e); throw e }
    },
    async isValidVault(dirPath: string) {
      try {
        const result = await backend.isValidVault(dirPath)
        const valid = result.valid
        const error = result.error
        return { valid, nodePath: valid ? dirPath : null, error: valid ? undefined : error || '不是有效的工作目录' }
      } catch (e) { logger.catch('Store.isValidVault', '校验 Vault 失败', e); throw e }
    },
    createWorkDir: async (dirPath: string) => {
      try {
        await backend.createVault(dirPath)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error)?.message || '创建工作目录失败' }
      }
    },
    async listKBs(): Promise<KBListItem[]> {
      try {
        return await backend.listKBs()
      } catch (e) { logger.catch('Store.listKBs', '列出知识库失败', e); throw e }
    },
    async createKB(name: string): Promise<void> {
      try {
        await backend.createKB(name)
      } catch (e) { logger.catch('Store.createKB', `创建知识库失败: ${name}`, e); throw e }
    },
    async deleteKB(kbPath: string) {
      try {
        await backend.deleteKB(kbPath)
      } catch (e) { logger.catch('Store.deleteKB', `删除知识库失败: ${kbPath}`, e); throw e }
    },
    async renameKB(kbPath: string, newName: unknown) {
      const safeName = ensureValidName(newName, '知识库名称')
      try {
        await backend.renameKB(kbPath, safeName)
      } catch (e) { logger.catch('Store.renameKB', `重命名知识库失败: ${kbPath} -> ${newName}`, e); throw e }
    },
    async listCards(kbPath: string) {
      try {
        return await backend.listCards(kbPath)
      } catch (e) { logger.catch('Store.listCards', `列出卡片失败: ${kbPath}`, e); throw e }
    },
    async createCard(kbPath: string, cardName: unknown) {
      const safeName = ensureValidName(cardName, '卡片目录名')
      try {
        const cardInfo = await backend.createCard(kbPath, safeName)
        return cardInfo.ref
      } catch (e) { logger.catch('Store.createCard', `创建卡片失败: ${kbPath}/${cardName}`, e); throw e }
    },
    async deleteCard(cardPath: string) {
      try {
        await backend.deleteCard(cardPath)
      } catch (e) { logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e); throw e }
    },
    async renameCard(cardPath: string, newName: unknown) {
      const safeName = ensureValidName(newName, '卡片名称')
      try {
        const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
        const siblings = await backend.listCards(parentPath)
        if (siblings.some(s => s.ref !== cardPath && (s?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`)
        await backend.renameCard(cardPath, safeName)
        return cardPath
      } catch (e) { logger.catch('Store.renameCard', `重命名卡片失败: ${cardPath} -> ${newName}`, e); throw e }
    },
    async listTopoDocuments(cardPath: string) {
      try { return await backend.listTopoDocuments(cardPath) } catch (e) { logger.catch('Store.listTopoDocuments', `列出多类型文档失败: ${cardPath}`, e); throw e }
    },
    async createTopoDocument(cardPath: string, input: TopoDocumentCreateInput) {
      const safeTitle = ensureValidName(input?.title, '文档名称')
      const type = ensureValidTopoDocumentType(input?.type)
      try { return await backend.createTopoDocument(cardPath, { type, title: safeTitle, parentId: input?.parentId || null }) } catch (e) { logger.catch('Store.createTopoDocument', `创建多类型文档失败: ${cardPath}/${safeTitle}`, e); throw e }
    },
    async readTopoDocument(cardPath: string, documentId: string) {
      try { return await backend.readTopoDocument(cardPath, documentId) } catch (e) { logger.catch('Store.readTopoDocument', `读取多类型文档失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async writeTopoDocument(cardPath: string, documentId: string, content: unknown) {
      try { await backend.writeTopoDocument(cardPath, documentId, content) } catch (e) { logger.catch('Store.writeTopoDocument', `写入多类型文档失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async renameTopoDocument(cardPath: string, documentId: string, title: unknown) {
      const safeTitle = ensureValidName(title, '文档名称')
      try { return await backend.renameTopoDocument(cardPath, documentId, safeTitle) } catch (e) { logger.catch('Store.renameTopoDocument', `重命名多类型文档失败: ${cardPath}/${documentId} -> ${safeTitle}`, e); throw e }
    },
    async deleteTopoDocument(cardPath: string, documentId: string) {
      try { await backend.deleteTopoDocument(cardPath, documentId) } catch (e) { logger.catch('Store.deleteTopoDocument', `删除多类型文档失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async moveTopoDocument(cardPath: string, documentId: string, newParentId: string | null, newSortOrder: number) {
      try { return await backend.moveTopoDocument(cardPath, documentId, newParentId, newSortOrder) } catch (e) { logger.catch('Store.moveTopoDocument', `移动多类型文档失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async repairTopoDocuments(cardPath: string) {
      try { return await backend.repairTopoDocuments(cardPath) } catch (e) { logger.catch('Store.repairTopoDocuments', `修复多类型文档失败: ${cardPath}`, e); throw e }
    },
    async exportTopoDocument(cardPath: string, documentId: string) {
      try { return await backend.exportTopoDocument(cardPath, documentId) } catch (e) { logger.catch('Store.exportTopoDocument', `导出多类型文档失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async openTopoDocumentFolder(cardPath: string, documentId: string) {
      try { return await backend.openTopoDocumentFolder(cardPath, documentId) } catch (e) { logger.catch('Store.openTopoDocumentFolder', `打开多类型文档目录失败: ${cardPath}/${documentId}`, e); throw e }
    },
    async listAttachments(cardPath: string) {
      try { return await backend.listAttachments(cardPath) } catch (e) { logger.catch('Store.listAttachments', `获取附件列表失败: ${cardPath}`, e); throw e }
    },
    async importAttachment(cardPath: string, sourceFilePath: string, targetFileName?: string) {
      try { return await backend.importAttachment(cardPath, sourceFilePath, targetFileName) } catch (e) { logger.catch('Store.importAttachment', `导入附件失败: ${cardPath}`, e); throw e }
    },
    async deleteAttachment(cardPath: string, attachmentName: string) {
      try { await backend.deleteAttachment(cardPath, attachmentName) } catch (e) { logger.catch('Store.deleteAttachment', `删除附件失败: ${cardPath}/${attachmentName}`, e); throw e }
    },
    async openAttachment(cardPath: string, attachmentRef: string) {
      try { return await backend.openAttachment(cardPath, attachmentRef) } catch (e) { logger.catch('Store.openAttachment', `打开附件失败: ${cardPath}/${attachmentRef}`, e); throw e }
    },
    async getAttachmentAbsoluteUrl(cardPath: string, attachmentRef: string) {
      try { return await backend.getAttachmentAbsoluteUrl(cardPath, attachmentRef) } catch (e) { logger.catch('Store.getAttachmentAbsoluteUrl', `获取附件URL失败: ${cardPath}/${attachmentRef}`, e); return null }
    },
    async writeAttachmentBase64(cardPath: string, fileName: string, mimeType: string, base64: string) {
      try { return await backend.writeAttachmentBase64(cardPath, fileName, mimeType, base64) } catch (e) { logger.catch('Store.writeAttachmentBase64', `写入附件失败: ${cardPath}/${fileName}`, e); throw e }
    },
    async downloadAttachment(cardPath: string, url: string, targetFileName?: string) {
      try { return await backend.downloadAttachment(cardPath, url, targetFileName) } catch (e) { logger.catch('Store.downloadAttachment', `下载附件失败: ${cardPath}`, e); throw e }
    },
    async readAttachmentDataUrl(cardPath: string, attachmentRef: string) {
      try { return await backend.readAttachmentDataUrl(cardPath, attachmentRef) } catch (e) { logger.catch('Store.readAttachmentDataUrl', `读取附件失败: ${cardPath}/${attachmentRef}`, e); throw e }
    },
    writeLayout: async (kbPath: string, meta: GraphMeta) => {
      try { await backend.writeLayout(kbPath, normalizeGraphMeta(meta)) } catch (e) { logger.catch('Store.writeLayout', `写入布局失败: ${kbPath}`, e); throw e }
    },
    readLayout: async (kbPath: string): Promise<GraphMeta> => {
      try { return normalizeGraphMeta(await backend.readLayout(kbPath)) } catch (e) { logger.catch('Store.readLayout', `读取布局失败: ${kbPath}`, e); throw e }
    },
    async saveLayout(kbPath: string, meta: GraphMeta) {
      try { await backend.writeLayout(kbPath, normalizeGraphMeta(meta)) } catch (e) { logger.catch('Store.saveLayout', `保存布局失败: ${kbPath}`, e); throw e }
    },
    saveGraphDebounced(kbPath: string, buildMetaFn: () => GraphMeta, onSaved?: () => void): Promise<void> {
      if (!kbPath) return Promise.resolve()
      return layoutSaveCoordinator.schedule(kbPath, buildMetaFn, onSaved)
    },
    flushGraphSave(kbPath: string, buildMetaFn: () => GraphMeta, onSaved?: () => void): Promise<void> {
      if (!kbPath) return Promise.resolve()
      return layoutSaveCoordinator.flush(kbPath, buildMetaFn, onSaved)
    },
    async importKB(sourcePath: string) {
      try {
        return await backend.importKB(sourcePath)
      } catch (e) { logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e); throw e }
    },
    async countChildren(cardPath: string) {
      try {
        return (await backend.listCards(cardPath)).length
      } catch (e) { logger.catch('Store.countChildren', `统计子节点失败: ${cardPath}`, e); throw e }
    },
    async readConfig(): Promise<VaultConfig> {
      const now = Date.now()
      if (cachedConfigTimestamp && now - cachedConfigTimestamp < CONFIG_CACHE_TTL) return cachedConfig
      try {
        cachedConfig = normalizeConfig(await backend.readConfig())
        cachedConfigTimestamp = now
        return cachedConfig
      } catch {
        cachedConfig = normalizeConfig({})
        cachedConfigTimestamp = now
        return cachedConfig
      }
    },
    async writeConfig(config: VaultConfig) {
      try {
        const nextConfig = { ...cachedConfig, ...config }
        if (config.defaultEdgeStyle) {
          nextConfig.defaultEdgeStyle = { ...cachedConfig.defaultEdgeStyle, ...config.defaultEdgeStyle }
        }
        if (config.defaultNodeStyle) {
          nextConfig.defaultNodeStyle = { ...cachedConfig.defaultNodeStyle, ...config.defaultNodeStyle }
        }
        if (config.defaultNodeSize) {
          nextConfig.defaultNodeSize = { ...cachedConfig.defaultNodeSize, ...config.defaultNodeSize }
        }
        if (config.defaultEditorStyle) {
          nextConfig.defaultEditorStyle = { ...cachedConfig.defaultEditorStyle, ...config.defaultEditorStyle }
        }
        if (config.nodeSizeLimits) {
          nextConfig.nodeSizeLimits = { ...cachedConfig.nodeSizeLimits, ...config.nodeSizeLimits }
        }
        if (config.nodeBadgeSize !== undefined) {
          nextConfig.nodeBadgeSize = config.nodeBadgeSize
        }
        if (config.kbCovers !== undefined) {
          nextConfig.kbCovers = config.kbCovers
        }
        if (config.kbCoverOffsets !== undefined) {
          nextConfig.kbCoverOffsets = config.kbCoverOffsets
        }
        const next = normalizeConfig(nextConfig)
        cachedConfig = next
        await backend.writeConfig(next)
      } catch (e) { logger.catch('Store.writeConfig', '保存工作目录配置失败', e); throw e }
    },
  }
  return store
}

export interface AttachmentItem {
  name: string
  path: string
  isImage: boolean
  size: number
  mtime: number
}

export type Store = ReturnType<typeof createStore>
