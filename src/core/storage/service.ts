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
  nodeSizeLimits?: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }
  nodeBadgeSize?: number
  kbCovers?: Record<string, string>
  kbOrder?: string[]
  [key: string]: unknown
}

export interface DetailDocumentItem {
  path: string
  name: string
  isDefault: boolean
  isCard?: boolean
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

  readMarkdown: (cardPath: string) => Promise<string>
  writeMarkdown: (cardPath: string, content: string) => Promise<void>
  listDetailDocuments: (cardPath: string) => Promise<DetailDocumentItem[]>
  readDetailDocument: (cardPath: string, documentPath: string) => Promise<string>
  writeDetailDocument: (cardPath: string, documentPath: string, content: string) => Promise<void>
  createDetailDocument: (cardPath: string, name: string) => Promise<DetailDocumentItem>
  renameDetailDocument: (cardPath: string, documentPath: string, nextName: string) => Promise<DetailDocumentItem>
  deleteDetailDocument: (cardPath: string, documentPath: string) => Promise<void>
  readCardMarkdown: (cardPath: string) => Promise<string>
  writeCardMarkdown: (cardPath: string, content: string) => Promise<void>
  
  listAttachments: (cardPath: string) => Promise<AttachmentItem[]>
  importAttachment: (cardPath: string, sourceFilePath: string) => Promise<string>
  deleteAttachment: (cardPath: string, attachmentName: string) => Promise<void>
  openAttachment: (cardPath: string, attachmentRef: string) => Promise<boolean>
  getAttachmentAbsoluteUrl: (cardPath: string, attachmentRef: string) => Promise<string | null>
  
  writeAttachmentBase64: (cardPath: string, fileName: string, mimeType: string, base64: string) => Promise<string>
  downloadAttachment: (cardPath: string, url: string) => Promise<string>
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
  const limits = (c.nodeSizeLimits && typeof c.nodeSizeLimits === 'object' && !Array.isArray(c.nodeSizeLimits)) ? c.nodeSizeLimits as Record<string, unknown> : {}
  const edgeDefaultsVersion = c.edgeDefaultsVersion === 2 ? 2 : undefined
  
  const covers = (c.kbCovers && typeof c.kbCovers === 'object' && !Array.isArray(c.kbCovers)) ? c.kbCovers as Record<string, unknown> : {}
  const kbCovers: Record<string, string> = {}
  for (const [k, v] of Object.entries(covers)) {
    if (typeof v === 'string') kbCovers[k] = v
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
    nodeSizeLimits: {
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
    },
    nodeBadgeSize: clampNumber(finiteNumber(c.nodeBadgeSize, 14), 8, 28),
    kbCovers,
    kbOrder,
  }
}
function ensureValidName(name: unknown, label = '名称'): string {
  const n = normalizeName(name)
  if (!n) throw new Error(`${label}不能为空`)
  if (n === '.' || n === '..') throw new Error(`${label}不合法`)
  return n
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
    async readMarkdown(cardPath: string) {
      try { return await backend.readMarkdown(cardPath) } catch (e) { logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e); throw e }
    },
    async writeMarkdown(cardPath: string, content: string) {
      try { await backend.writeMarkdown(cardPath, content) } catch (e) { logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e); throw e }
    },
    async listDetailDocuments(cardPath: string) {
      try { return await backend.listDetailDocuments(cardPath) } catch (e) { logger.catch('Store.listDetailDocuments', `列出详情文档失败: ${cardPath}`, e); throw e }
    },
    async readDetailDocument(cardPath: string, documentPath: string) {
      try { return await backend.readDetailDocument(cardPath, documentPath) } catch (e) { logger.catch('Store.readDetailDocument', `读取详情文档失败: ${cardPath}/${documentPath}`, e); throw e }
    },
    async writeDetailDocument(cardPath: string, documentPath: string, content: string) {
      try { await backend.writeDetailDocument(cardPath, documentPath, content) } catch (e) { logger.catch('Store.writeDetailDocument', `写入详情文档失败: ${cardPath}/${documentPath}`, e); throw e }
    },
    async createDetailDocument(cardPath: string, name: unknown) {
      const safeName = ensureValidName(name, '文档名称')
      try { return await backend.createDetailDocument(cardPath, safeName) } catch (e) { logger.catch('Store.createDetailDocument', `创建详情文档失败: ${cardPath}/${name}`, e); throw e }
    },
    async renameDetailDocument(cardPath: string, documentPath: string, nextName: unknown) {
      const safeName = ensureValidName(nextName, '文档名称')
      try { return await backend.renameDetailDocument(cardPath, documentPath, safeName) } catch (e) { logger.catch('Store.renameDetailDocument', `重命名详情文档失败: ${cardPath}/${documentPath} -> ${nextName}`, e); throw e }
    },
    async deleteDetailDocument(cardPath: string, documentPath: string) {
      try { await backend.deleteDetailDocument(cardPath, documentPath) } catch (e) { logger.catch('Store.deleteDetailDocument', `删除详情文档失败: ${cardPath}/${documentPath}`, e); throw e }
    },
    async listAttachments(cardPath: string) {
      try { return await backend.listAttachments(cardPath) } catch (e) { logger.catch('Store.listAttachments', `获取附件列表失败: ${cardPath}`, e); throw e }
    },
    async importAttachment(cardPath: string, sourceFilePath: string) {
      try { return await backend.importAttachment(cardPath, sourceFilePath) } catch (e) { logger.catch('Store.importAttachment', `导入附件失败: ${cardPath}`, e); throw e }
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
    async readCardMarkdown(cardPath: string) {
      try { return await backend.readCardMarkdown(cardPath) } catch (e) { logger.catch('Store.readCardMarkdown', `读取卡片内容失败: ${cardPath}`, e); throw e }
    },
    async writeCardMarkdown(cardPath: string, content: string) {
      try { await backend.writeCardMarkdown(cardPath, content) } catch (e) { logger.catch('Store.writeCardMarkdown', `写入卡片内容失败: ${cardPath}`, e); throw e }
    },
    async writeAttachmentBase64(cardPath: string, fileName: string, mimeType: string, base64: string) {
      try { return await backend.writeAttachmentBase64(cardPath, fileName, mimeType, base64) } catch (e) { logger.catch('Store.writeAttachmentBase64', `写入附件失败: ${cardPath}/${fileName}`, e); throw e }
    },
    async downloadAttachment(cardPath: string, url: string) {
      try { return await backend.downloadAttachment(cardPath, url) } catch (e) { logger.catch('Store.downloadAttachment', `下载附件失败: ${cardPath}`, e); throw e }
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
        if (config.nodeSizeLimits) {
          nextConfig.nodeSizeLimits = { ...cachedConfig.nodeSizeLimits, ...config.nodeSizeLimits }
        }
        if (config.nodeBadgeSize !== undefined) {
          nextConfig.nodeBadgeSize = config.nodeBadgeSize
        }
        if (config.kbCovers !== undefined) {
          nextConfig.kbCovers = config.kbCovers
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
