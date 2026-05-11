/**
 * 统一存储服务。
 * 业务层通过 useStorage() 调用，底层存储由 StorageBackend 隔离。
 */
import { logger } from '../logger'
import type { GraphMeta, StorageBackend } from './types'
import type { KBListItem } from '../../types'
import { SaveCoordinator } from '../../domain/persistence/saveCoordinator'
import { normalizeGraphMeta } from '../../domain/graph/normalizeGraphMeta'

interface VaultConfig {
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  [key: string]: unknown
}

function normalizeName(name: unknown): string { return String(name || '').trim() }
function normalizeConfig(configRaw: unknown): VaultConfig {
  const c = (configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)) ? configRaw as Record<string, unknown> : {}
  const s = (c.defaultEdgeStyle && typeof c.defaultEdgeStyle === 'object' && !Array.isArray(c.defaultEdgeStyle)) ? c.defaultEdgeStyle as Record<string, unknown> : {}
  return {
    defaultEdgeStyle: {
      lineMode: s.lineMode === 'straight' ? 'straight' : 'smoothstep',
      lineStyle: s.lineStyle === 'dashed' ? 'dashed' : 'solid',
      color: typeof s.color === 'string' ? s.color : '#7f8c8d',
      arrow: typeof s.arrow === 'boolean' ? s.arrow : true,
    },
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
    async createKB(name: unknown) {
      const safeName = ensureValidName(name, '知识库名称')
      try {
        return await backend.createKB(safeName)
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
      const safeName = ensureValidName(cardName, '卡片名称')
      try {
        const existing = await backend.listCards(kbPath)
        if (existing.some(c => (c?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`)
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
        const next = normalizeConfig({ ...cachedConfig, ...config, defaultEdgeStyle: { ...cachedConfig.defaultEdgeStyle, ...config.defaultEdgeStyle } })
        cachedConfig = next
        await backend.writeConfig(next)
      } catch (e) { logger.catch('Store.writeConfig', '保存工作目录配置失败', e); throw e }
    },
  }
  return store
}

export type Store = ReturnType<typeof createStore>
