/**
 * 统一存储服务。
 * 业务层通过 useStorage() 调用，底层存储由 StorageBackend 隔离。
 */
import { logger } from '../logger'
import type { KBListItem } from '../../types'
import type { GraphMeta } from '../../domain/graph/model'
import { SaveCoordinator } from '../../domain/persistence/saveCoordinator'
import { normalizeGraphMeta } from '../../domain/graph/normalizeGraphMeta'
import { isTopoDocumentType, type TopoDocumentType } from '../topoDocumentTypes'
import { normalizeConfig } from './normalizeConfig'
import type { StorageBackend, TopoDocumentCreateInput, VaultConfig } from './types'
export type {
  AttachmentItem,
  AttachmentStorageBackend,
  CardStorageBackend,
  ConfigStorageBackend,
  GraphLayoutStorageBackend,
  KnowledgeBaseStorageBackend,
  StorageBackend,
  TopoDocumentCreateInput,
  TopoDocumentExportPayload,
  TopoDocumentManifest,
  TopoDocumentManifestItem,
  TopoDocumentRepairResult,
  TopoDocumentStorageBackend,
  VaultConfig,
  VaultStorageBackend,
} from './types'

function normalizeName(name: unknown): string { return String(name || '').trim() }
function ensureValidName(name: unknown, label = '名称'): string {
  const n = normalizeName(name)
  if (!n) throw new Error(`${label}不能为空`)
  if (n === '.' || n === '..') throw new Error(`${label}不合法`)
  return n
}
function ensureValidTopoDocumentType(type: unknown): TopoDocumentType {
  if (isTopoDocumentType(type)) return type
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
    async listTrashKBs() {
      try {
        return await backend.listTrashKBs()
      } catch (e) { logger.catch('Store.listTrashKBs', '列出回收站知识库失败', e); throw e }
    },
    async restoreTrashKB(trashName: string) {
      try {
        return await backend.restoreTrashKB(trashName)
      } catch (e) { logger.catch('Store.restoreTrashKB', `恢复知识库失败: ${trashName}`, e); throw e }
    },
    async clearTrashKBs() {
      try {
        await backend.clearTrashKBs()
      } catch (e) { logger.catch('Store.clearTrashKBs', '清空知识库回收站失败', e); throw e }
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
    async listTrashTopoDocuments(cardPath: string) {
      try { return await backend.listTrashTopoDocuments(cardPath) } catch (e) { logger.catch('Store.listTrashTopoDocuments', `列出多类型文档回收站失败: ${cardPath}`, e); throw e }
    },
    async restoreTrashTopoDocument(cardPath: string, trashName: string) {
      try { return await backend.restoreTrashTopoDocument(cardPath, trashName) } catch (e) { logger.catch('Store.restoreTrashTopoDocument', `恢复多类型文档失败: ${cardPath}/${trashName}`, e); throw e }
    },
    async clearTrashTopoDocuments(cardPath: string) {
      try { await backend.clearTrashTopoDocuments(cardPath) } catch (e) { logger.catch('Store.clearTrashTopoDocuments', `清空多类型文档回收站失败: ${cardPath}`, e); throw e }
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
    async listTrashAttachments(cardPath: string) {
      try { return await backend.listTrashAttachments(cardPath) } catch (e) { logger.catch('Store.listTrashAttachments', `列出附件回收站失败: ${cardPath}`, e); throw e }
    },
    async restoreTrashAttachment(cardPath: string, trashName: string) {
      try { return await backend.restoreTrashAttachment(cardPath, trashName) } catch (e) { logger.catch('Store.restoreTrashAttachment', `恢复附件失败: ${cardPath}/${trashName}`, e); throw e }
    },
    async clearTrashAttachments(cardPath: string) {
      try { await backend.clearTrashAttachments(cardPath) } catch (e) { logger.catch('Store.clearTrashAttachments', `清空附件回收站失败: ${cardPath}`, e); throw e }
    },
    async showAttachmentInFolder(cardPath: string, attachmentRef: string) {
      try { return await backend.showAttachmentInFolder(cardPath, attachmentRef) } catch (e) { logger.catch('Store.showAttachmentInFolder', `在文件夹中显示附件失败: ${cardPath}/${attachmentRef}`, e); throw e }
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

export type Store = ReturnType<typeof createStore>
