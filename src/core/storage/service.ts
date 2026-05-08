/**
 * 统一存储服务。
 * 业务层通过 useStorage() 调用，底层存储由 StorageAdapter 隔离。
 */
import { logger } from '../logger'
import type { StorageAdapter, StorageChildInfo, StorageDialogResult, StorageGraphMeta } from './adapter'
import type { EdgeRelation, EdgeWeight, KBInfo, KBRef } from './adapter'
import type { KBListItem } from '../../types'

interface VaultConfig {
  lastOpenedKB?: string | null
  orders?: Record<string, number>
  covers?: Record<string, unknown>
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  [key: string]: unknown
}

function normalizeMeta(metaRaw: unknown): StorageGraphMeta {
  const meta = (metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)) ? metaRaw as Record<string, unknown> : {}
  const rawEdges = Array.isArray(meta.edges) ? meta.edges : []
  type EdgeItem = { id: string; source: string; target: string; relation: EdgeRelation; weight: EdgeWeight; lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean; highlighted?: boolean; faded?: boolean }
  const edges = rawEdges.map((e): EdgeItem | null => {
    if (!e || typeof e !== 'object') return null
    const edge = e as Record<string, unknown>
    const source = (edge.source || edge.from || '') as string
    const target = (edge.target || edge.to || '') as string
    if (!source || !target) return null
    return { id: (edge.id as string | undefined) ?? `e-${source}-${target}`, source, target, relation: (edge.relation || '相关') as EdgeRelation, weight: (edge.weight || 'minor') as EdgeWeight, lineMode: edge.lineMode === 'straight' ? 'straight' : 'smoothstep', lineStyle: edge.lineStyle === 'dashed' ? 'dashed' : 'solid', color: typeof edge.color === 'string' ? edge.color : undefined, arrow: typeof edge.arrow === 'boolean' ? edge.arrow : undefined, highlighted: typeof edge.highlighted === 'boolean' ? (edge.highlighted as boolean) : undefined, faded: typeof edge.faded === 'boolean' ? (edge.faded as boolean) : undefined }
  }).filter((e): e is NonNullable<typeof e> => e !== null)
  return { children: (meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children)) ? (meta.children as Record<string, StorageChildInfo>) : undefined, edges: edges as StorageGraphMeta['edges'], zoom: typeof meta.zoom === 'number' && Number.isFinite(meta.zoom) ? meta.zoom as number : null, pan: (meta.pan && typeof meta.pan === 'object' && Number.isFinite((meta.pan as { x?: number }).x) && Number.isFinite((meta.pan as { y?: number }).y)) ? { x: (meta.pan as { x: number }).x, y: (meta.pan as { y: number }).y } : null, canvasBounds: (meta.canvasBounds && typeof meta.canvasBounds === 'object') ? meta.canvasBounds as StorageGraphMeta['canvasBounds'] : null }
}

export class SaveManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  setTimer(key: string, timer: ReturnType<typeof setTimeout>) { const old = this.timers.get(key); if (old) clearTimeout(old); this.timers.set(key, timer) }
  clearTimer(key: string) { const timer = this.timers.get(key); if (timer) { clearTimeout(timer); this.timers.delete(key) } }
  clearAll() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear() }
}

class ImageUrlRegistry {
  private registry = new Map<string, string>()
  register(path: string, url: string) { const old = this.registry.get(path); if (old) { try { URL.revokeObjectURL(old) } catch (e) { logger.warn('Store', `revokeImageUrl ${path}`, e) } } this.registry.set(path, url) }
  revokeAll() { for (const [path, url] of this.registry) { try { URL.revokeObjectURL(url) } catch (e) { logger.warn('Store', `revokeImageUrl ${path}`, e) } } this.registry.clear() }
}

function normalizeName(name: unknown): string { return String(name || '').trim() }
function normalizeConfig(configRaw: unknown): VaultConfig { const c = (configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)) ? configRaw as Record<string, unknown> : {}; const s = (c.defaultEdgeStyle && typeof c.defaultEdgeStyle === 'object' && !Array.isArray(c.defaultEdgeStyle)) ? c.defaultEdgeStyle as Record<string, unknown> : {}; return { lastOpenedKB: typeof c.lastOpenedKB === 'string' ? c.lastOpenedKB : null, orders: (c.orders && typeof c.orders === 'object' && !Array.isArray(c.orders)) ? c.orders as Record<string, number> : {}, covers: (c.covers && typeof c.covers === 'object' && !Array.isArray(c.covers)) ? c.covers as Record<string, unknown> : {}, defaultEdgeStyle: { lineMode: s.lineMode === 'straight' ? 'straight' : 'smoothstep', lineStyle: s.lineStyle === 'dashed' ? 'dashed' : 'solid', color: typeof s.color === 'string' ? s.color : '#7f8c8d', arrow: typeof s.arrow === 'boolean' ? s.arrow : true } } }
function ensureValidName(name: unknown, label = '名称'): string { const n = normalizeName(name); if (!n) throw new Error(`${label}不能为空`); if (n === '.' || n === '..') throw new Error(`${label}不合法`); return n }

export interface DirEntry { path: string; name: string; isDir: boolean; order?: number }
export type DirDialogResult = StorageDialogResult
export interface SaveImageResult { path: string; markdownRef: string }

export function createStore(adapter: StorageAdapter) {
  const saveManager = new SaveManager()
  const imageUrls = new ImageUrlRegistry()
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024
  let cachedConfig: VaultConfig = normalizeConfig({})
  let cachedConfigTimestamp = 0
  const CONFIG_CACHE_TTL = 30000

  const store = {
    init() { try { return adapter.initVault() } catch (e) { logger.catch('Store.init', '初始化 Vault 失败', e); throw e } },
    setWorkDir(dirPath: string): Promise<DirDialogResult> { try { return adapter.setVault(dirPath) as Promise<DirDialogResult> } catch (e) { logger.catch('Store.setWorkDir', '设置 Vault 失败', e); throw e } },
    selectWorkDirCandidate(): Promise<DirDialogResult> { try { return adapter.selectVaultCandidate() as Promise<DirDialogResult> } catch (e) { logger.catch('Store.selectWorkDirCandidate', '选择 Vault 候选失败', e); throw e } },
    createWorkDir(dirPath: string): Promise<DirDialogResult> { try { return adapter.createVault(dirPath) as Promise<DirDialogResult> } catch (e) { logger.catch('Store.createWorkDir', '创建 Vault 失败', e); throw e } },
    async listKBs(): Promise<KBListItem[]> { try { const entries = await adapter.listKnowledgeBases(); return entries.map(d => ({ path: d.path, name: d.name, order: d.order ?? 0 })) } catch (e) { logger.catch('Store.listKBs', '列出知识库失败', e); throw e } },
    async createKB(name: unknown) { const safeName = ensureValidName(name, '知识库名称'); try { const existing = await adapter.listKnowledgeBases(); const maxOrder = existing.reduce((m, kb) => Number.isFinite(kb.order) && (kb.order as number) > m ? kb.order as number : m, -1); const actualPath = await adapter.createKnowledgeBase(safeName, null); await adapter.setKnowledgeBaseOrder(actualPath, maxOrder + 1); return actualPath || safeName } catch (e) { logger.catch('Store.createKB', `创建知识库失败: ${name}`, e); throw e } },
    async deleteKB(name: string) { try { return await adapter.deleteKnowledgeBase(name) } catch (e) { logger.catch('Store.deleteKB', `删除知识库失败: ${name}`, e); throw e } },
    async saveKBCover(kbPath: string, coverPath: string | null) { try { return await adapter.saveKnowledgeBaseCover(kbPath, coverPath) } catch (e) { logger.catch('Store.saveKBCover', `保存知识库封面失败: ${kbPath}`, e); throw e } },
    async renameKB(kbPath: string, newName: unknown) { const safeName = ensureValidName(newName, '知识库名称'); try { return await adapter.renameKnowledgeBase(kbPath, safeName) } catch (e) { logger.catch('Store.renameKB', `重命名知识库失败: ${kbPath} -> ${newName}`, e); throw e } },
    async listCards(parentPath: string) { try { return await adapter.listCards(parentPath) } catch (e) { logger.catch('Store.listCards', `列出卡片失败: ${parentPath}`, e); throw e } },
    async createCard(parentPath: string, cardName: unknown) { const safeName = ensureValidName(cardName, '卡片名称'); try { const children = await adapter.listCards(parentPath || ''); if ((children || []).some(c => (c?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`); const cardPath = parentPath ? `${parentPath}/${safeName}` : safeName; return await adapter.createCard(cardPath, null) } catch (e) { logger.catch('Store.createCard', `创建卡片失败: ${parentPath}/${cardName}`, e); throw e } },
    async deleteCard(cardPath: string) { try { return await adapter.deleteCard(cardPath) } catch (e) { logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e); throw e } },
    async renameCard(cardPath: string, newName: unknown) { const safeName = ensureValidName(newName, '卡片名称'); try { const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''; const siblings = await adapter.listCards(parentPath); if ((siblings || []).some(s => s.path !== cardPath && (s?.name || '').trim() === safeName)) throw new Error(`同级下已存在同名卡片：${safeName}`); const newPath = await adapter.renameCard(cardPath, safeName); return newPath || cardPath } catch (e) { logger.catch('Store.renameCard', `重命名卡片失败: ${cardPath} -> ${newName}`, e); throw e } },
    async readMarkdown(cardPath: string) { try { return await adapter.readCardMarkdown(cardPath) } catch (e) { logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e); throw e } },
    async writeMarkdown(cardPath: string, content: string) { try { return await adapter.writeCardMarkdown(cardPath, content) } catch (e) { logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e); throw e } },
    async readLayout(dirPath: string): Promise<StorageGraphMeta> { try { return normalizeMeta(await adapter.readCardLayout(dirPath)) as StorageGraphMeta } catch (e) { logger.catch('Store.readLayout', `读取布局失败: ${dirPath}`, e); throw e } },
    async saveLayout(dirPath: string, meta: unknown) { try { return await adapter.writeCardLayout(dirPath, normalizeMeta(meta)) } catch (e) { logger.catch('Store.saveLayout', `保存布局失败: ${dirPath}`, e); throw e } },
    saveGraphDebounced(dirPath: string, buildMetaFn: () => unknown, onSaved?: () => void): Promise<void> { if (!dirPath) return Promise.resolve(); saveManager.clearTimer(dirPath); return new Promise(resolve => { const timer = setTimeout(async () => { try { await store.saveLayout(dirPath, buildMetaFn()); onSaved?.() } catch (e) { logger.catch('Store.saveGraphDebounced', `保存布局失败: ${dirPath}`, e) } finally { resolve() } }, 300); saveManager.setTimer(dirPath, timer) }) },
    flushGraphSave(dirPath: string, buildMetaFn: () => unknown, onSaved?: () => void): Promise<void> { if (!dirPath) return Promise.resolve(); saveManager.clearTimer(dirPath); return store.saveLayout(dirPath, buildMetaFn()).then(() => onSaved?.()) },
    async saveImage(cardPath: string, blob: Blob, filename: string): Promise<SaveImageResult> { if (blob.size > MAX_IMAGE_SIZE) throw new Error(`图片大小超过限制（最大 5MB），当前 ${(blob.size / 1024 / 1024).toFixed(1)}MB`); const imgPath = `${cardPath}/images/${filename}`; try { const buffer = await blob.arrayBuffer(); await adapter.writeCardAsset(imgPath, buffer); return { path: imgPath, markdownRef: `images/${filename}` } } catch (e) { logger.catch('Store.saveImage', `保存图片失败: ${imgPath}`, e); throw e } },
    async loadImage(imgPath: string): Promise<string> { try { const buffer = await adapter.readCardAsset(imgPath); if (!buffer) return ''; const url = URL.createObjectURL(new Blob([buffer])); imageUrls.register(imgPath, url); return url } catch (e) { logger.catch('Store.loadImage', `加载图片失败: ${imgPath}`, e); throw e } },
    revokeAllImageUrls() { imageUrls.revokeAll() },
    async clearAll() { try { return await adapter.clearVault() } catch (e) { logger.catch('Store.clearAll', '清除所有数据失败', e); throw e } },
    async importKB(sourcePath: string) { try { return await adapter.importKnowledgeBase(sourcePath) } catch (e) { logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e); throw e } },
    async openInFinder(p: string) { try { return await adapter.openCardLocation(p) } catch (e) { logger.catch('Store.openInFinder', `打开目录失败: ${p}`, e); throw e } },
    async countChildren(p: string) { try { return await adapter.countCards(p) } catch (e) { logger.catch('Store.countChildren', `统计子节点失败: ${p}`, e); throw e } },
    async getRootDir(): Promise<string | null> { try { return await adapter.getVaultRoot() } catch (e) { logger.catch('Store.getRootDir', '获取根目录失败', e); throw e } },
    getLastOpenedKB() { try { return adapter.getLastOpenedKnowledgeBase() } catch (e) { logger.catch('Store.getLastOpenedKB', '获取上次打开的知识库失败', e); throw e } },
    setLastOpenedKB(kbPath: string | null) { try { return adapter.setLastOpenedKnowledgeBase(kbPath) } catch (e) { logger.catch('Store.setLastOpenedKB', `设置上次打开的知识库失败: ${kbPath}`, e); throw e } },
    ensureCardDir(cardPath: string) { try { return adapter.ensureCard(cardPath) } catch (e) { logger.catch('Store.ensureCardDir', `确保目录存在失败: ${cardPath}`, e); throw e } },
    async readConfig(): Promise<VaultConfig> { const now = Date.now(); if (cachedConfigTimestamp && now - cachedConfigTimestamp < CONFIG_CACHE_TTL) return cachedConfig; try { cachedConfig = normalizeConfig(await adapter.readAppConfig()); cachedConfigTimestamp = now; return cachedConfig } catch { cachedConfig = normalizeConfig({}); cachedConfigTimestamp = now; return cachedConfig } },
    async writeConfig(config: VaultConfig) { try { const next = normalizeConfig({ ...cachedConfig, ...config, defaultEdgeStyle: { ...cachedConfig.defaultEdgeStyle, ...config.defaultEdgeStyle } }); cachedConfig = next; return await adapter.writeAppConfig(next) } catch (e) { logger.catch('Store.writeConfig', '保存工作目录配置失败', e); throw e } },
  }
  return store
}

export const Store = createStore({
  initVault: async () => { throw new Error('Default store requires injected adapter') },
  setVault: async () => { throw new Error('Default store requires injected adapter') },
  selectVaultCandidate: async () => { throw new Error('Default store requires injected adapter') },
  createVault: async () => { throw new Error('Default store requires injected adapter') },
  getVaultRoot: async () => null,
  clearVault: async () => { throw new Error('Default store requires injected adapter') },
  listKnowledgeBases: async () => [],
  createKnowledgeBase: async () => { throw new Error('Default store requires injected adapter') },
  deleteKnowledgeBase: async () => { throw new Error('Default store requires injected adapter') },
  renameKnowledgeBase: async () => { throw new Error('Default store requires injected adapter') },
  setKnowledgeBaseOrder: async () => { throw new Error('Default store requires injected adapter') },
  saveKnowledgeBaseCover: async () => { throw new Error('Default store requires injected adapter') },
  importKnowledgeBase: async () => { throw new Error('Default store requires injected adapter') },
  getLastOpenedKnowledgeBase: async () => null,
  setLastOpenedKnowledgeBase: async () => { throw new Error('Default store requires injected adapter') },
  listCards: async () => [],
  createCard: async () => { throw new Error('Default store requires injected adapter') },
  deleteCard: async () => { throw new Error('Default store requires injected adapter') },
  renameCard: async () => { throw new Error('Default store requires injected adapter') },
  ensureCard: async () => { throw new Error('Default store requires injected adapter') },
  countCards: async () => 0,
  openCardLocation: async () => { throw new Error('Default store requires injected adapter') },
  readCardMarkdown: async () => '',
  writeCardMarkdown: async () => { throw new Error('Default store requires injected adapter') },
  readCardLayout: async () => ({ children: undefined, edges: [] }),
  writeCardLayout: async () => { throw new Error('Default store requires injected adapter') },
  writeCardAsset: async () => { throw new Error('Default store requires injected adapter') },
  readCardAsset: async () => null,
  readAppConfig: async () => ({}),
  writeAppConfig: async () => { throw new Error('Default store requires injected adapter') },
})

export default Store
