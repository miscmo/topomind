/**
 * 统一存储服务。
 * 业务层通过 useStorage() 调用，底层存储由 StorageAdapter 隔离。
 */
import { logger } from '../logger'
import type { StorageAdapterExtended } from './adapter'
import type { GraphMeta } from './adapter/graph'
import type { KBListItem } from '../../types'

interface VaultConfig {
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  [key: string]: unknown
}

export class SaveManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  setTimer(key: string, timer: ReturnType<typeof setTimeout>) { const old = this.timers.get(key); if (old) clearTimeout(old); this.timers.set(key, timer) }
  clearTimer(key: string) { const timer = this.timers.get(key); if (timer) { clearTimeout(timer); this.timers.delete(key) } }
  clearAll() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear() }
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

export interface DirEntry { path: string; name: string; isDir: boolean; order?: number }
export function createStore(adapter: StorageAdapterExtended) {
  const saveManager = new SaveManager()
  let cachedConfig: VaultConfig = normalizeConfig({})
  let cachedConfigTimestamp = 0
  const CONFIG_CACHE_TTL = 30000

  const store = {
    init() { try { return adapter.createVault('') } catch (e) { logger.catch('Store.init', '初始化 Vault 失败', e); throw e } },
    async isValidVault(dirPath: string) {
      try {
        const valid = await adapter.isValidVault(dirPath)
        return { valid, nodePath: valid ? dirPath : null, error: valid ? undefined : '不是有效的工作目录' }
      } catch (e) { logger.catch('Store.isValidVault', '校验 Vault 失败', e); throw e }
    },
    createWorkDir: async (dirPath: string) => {
      try {
        await adapter.createVault(dirPath)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error)?.message || '创建工作目录失败' }
      }
    },
    async listKBs(): Promise<KBListItem[]> {
      try {
        const entries = await adapter.listKBS('')
        return entries.map(d => ({ path: d.ref, name: d.name, order: 0 }))
      } catch (e) { logger.catch('Store.listKBs', '列出知识库失败', e); throw e }
    },
    async createKB(name: unknown) {
      const safeName = ensureValidName(name, '知识库名称')
      try {
        const kbInfo = await adapter.createKB('', safeName)
        return kbInfo.ref || safeName
      } catch (e) { logger.catch('Store.createKB', `创建知识库失败: ${name}`, e); throw e }
    },
    async deleteKB(kbPath: string) {
      try {
        await adapter.deleteKB({ ref: kbPath, name: '', coverRef: null })
      } catch (e) { logger.catch('Store.deleteKB', `删除知识库失败: ${kbPath}`, e); throw e }
    },
    async renameKB(kbPath: string, newName: unknown) {
      const safeName = ensureValidName(newName, '知识库名称')
      try {
        await adapter.renameKB({ ref: kbPath, name: '', coverRef: null }, safeName)
      } catch (e) { logger.catch('Store.renameKB', `重命名知识库失败: ${kbPath} -> ${newName}`, e); throw e }
    },
    async listCards(kbPath: string) {
      try {
        return await adapter.listCards(kbPath)
      } catch (e) { logger.catch('Store.listCards', `列出卡片失败: ${kbPath}`, e); throw e }
    },
    async createCard(kbPath: string, cardName: unknown) {
      const safeName = ensureValidName(cardName, '卡片名称')
      try {
        const existing = await adapter.listCards(kbPath)
        if (existing.some(c => (c?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`)
        const cardInfo = await adapter.createCard(kbPath, safeName)
        return cardInfo.ref
      } catch (e) { logger.catch('Store.createCard', `创建卡片失败: ${kbPath}/${cardName}`, e); throw e }
    },
    async deleteCard(cardPath: string) {
      try {
        await adapter.deleteCard(cardPath)
      } catch (e) { logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e); throw e }
    },
    async renameCard(cardPath: string, newName: unknown) {
      const safeName = ensureValidName(newName, '卡片名称')
      try {
        const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
        const siblings = await adapter.listCards(parentPath)
        if (siblings.some(s => s.ref !== cardPath && (s?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`)
        await adapter.renameCard(cardPath, safeName)
        return cardPath
      } catch (e) { logger.catch('Store.renameCard', `重命名卡片失败: ${cardPath} -> ${newName}`, e); throw e }
    },
    async readMarkdown(cardPath: string) {
      try { return await adapter.readCardMarkdown(cardPath) } catch (e) { logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e); throw e }
    },
    async writeMarkdown(cardPath: string, content: string) {
      try { await adapter.writeCardMarkdown(cardPath, content) } catch (e) { logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e); throw e }
    },
    writeLayout: async (kbPath: string, meta: GraphMeta) => {
      try { await adapter.writeCardLayout(kbPath, meta) } catch (e) { logger.catch('Store.writeLayout', `写入布局失败: ${kbPath}`, e); throw e }
    },
    readLayout: async (kbPath: string): Promise<GraphMeta> => {
      try { return await adapter.readCardLayout(kbPath) } catch (e) { logger.catch('Store.readLayout', `读取布局失败: ${kbPath}`, e); throw e }
    },
    async saveLayout(kbPath: string, meta: GraphMeta) {
      try { await adapter.writeCardLayout(kbPath, meta) } catch (e) { logger.catch('Store.saveLayout', `保存布局失败: ${kbPath}`, e); throw e }
    },
    saveGraphDebounced(kbPath: string, buildMetaFn: () => GraphMeta, onSaved?: () => void): Promise<void> {
      if (!kbPath) return Promise.resolve()
      saveManager.clearTimer(kbPath)
      return new Promise(resolve => {
        const timer = setTimeout(async () => {
          try { await store.saveLayout(kbPath, buildMetaFn()); onSaved?.() }
          catch (e) { logger.catch('Store.saveGraphDebounced', `保存布局失败: ${kbPath}`, e) }
          finally { resolve() }
        }, 300)
        saveManager.setTimer(kbPath, timer)
      })
    },
    flushGraphSave(kbPath: string, buildMetaFn: () => GraphMeta, onSaved?: () => void): Promise<void> {
      if (!kbPath) return Promise.resolve()
      saveManager.clearTimer(kbPath)
      return store.saveLayout(kbPath, buildMetaFn()).then(() => onSaved?.())
    },
    async importKB(sourcePath: string) {
      try {
        const imported = await adapter.importKB('', { ref: sourcePath, name: '', coverRef: null })
        return imported.ref
      } catch (e) { logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e); throw e }
    },
    async countChildren(cardPath: string) {
      try {
        return await adapter.countSubCards(cardPath)
      } catch (e) { logger.catch('Store.countChildren', `统计子节点失败: ${cardPath}`, e); throw e }
    },
    async readConfig(): Promise<VaultConfig> {
      const now = Date.now()
      if (cachedConfigTimestamp && now - cachedConfigTimestamp < CONFIG_CACHE_TTL) return cachedConfig
      try {
        cachedConfig = normalizeConfig(await adapter.readAppConfig())
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
        await adapter.writeAppConfig(next)
      } catch (e) { logger.catch('Store.writeConfig', '保存工作目录配置失败', e); throw e }
    },
  }
  return store
}

export type Store = ReturnType<typeof createStore>

const stubAdapter: StorageAdapterExtended = {
  createVault: async () => ({ ref: '' }),
  isValidVault: async () => false,
  getVaultInfo: async () => ({ ref: '' }),
  removeVault: async () => undefined,
  listKBS: async () => [],
  createKB: async () => { throw new Error('Default store requires injected adapter') },
  deleteKB: async () => { throw new Error('Default store requires injected adapter') },
  renameKB: async () => { throw new Error('Default store requires injected adapter') },
  importKB: async () => { throw new Error('Default store requires injected adapter') },
  listCards: async () => [],
  createCard: async () => { throw new Error('Default store requires injected adapter') },
  deleteCard: async () => { throw new Error('Default store requires injected adapter') },
  renameCard: async () => { throw new Error('Default store requires injected adapter') },
  countSubCards: async () => 0,
  readCardLayout: async () => ({ nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }),
  writeCardLayout: async () => undefined,
  readCardMarkdown: async () => '',
  writeCardMarkdown: async () => undefined,
  readAppConfig: async () => ({}),
  writeAppConfig: async () => undefined,
} as unknown as StorageAdapterExtended

export const Store = createStore(stubAdapter)

export default Store