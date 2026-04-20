/**
 * 统一存储适配器（Electron 桌面端专用）
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend'
import { logger } from './logger'
import type { FSBChildInfo, FSBGraphMeta, FSBResult } from './fs-backend'
import type { EdgeRelation, EdgeWeight } from '../types'

// ===== normalizeMeta — 将原始图元数据规范化为稳定结构 =====

function normalizeMeta(metaRaw: unknown): FSBGraphMeta {
  const meta = (metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)) ? metaRaw as Record<string, unknown> : {}
  const zoom = (typeof meta.zoom === 'number' && Number.isFinite(meta.zoom)) ? meta.zoom as number : null
  const pan = (meta.pan && typeof meta.pan === 'object'
    && Number.isFinite((meta.pan as { x?: number }).x)
    && Number.isFinite((meta.pan as { y?: number }).y))
    ? { x: (meta.pan as { x: number }).x, y: (meta.pan as { y: number }).y }
    : null
  const canvasBounds = (meta.canvasBounds && typeof meta.canvasBounds === 'object') ? meta.canvasBounds : null

  const rawEdges = Array.isArray(meta.edges) ? meta.edges : []
  type EdgeItem = { id: string; source: string; target: string; relation: EdgeRelation; weight: EdgeWeight }
  const edges: EdgeItem[] = rawEdges
    .map((e): EdgeItem | null => {
      if (!e || typeof e !== 'object') return null
      const edge = e as Record<string, unknown>
      const source = (edge.source || edge.from || '') as string
      const target = (edge.target || edge.to || '') as string
      if (!source || !target) return null
      return {
        id: (edge.id as string | undefined) ?? `e-${source}-${target}`,
        source,
        target,
        relation: (edge.relation || '相关') as EdgeRelation,
        weight: (edge.weight || 'minor') as EdgeWeight,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  return {
    children: (meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children))
      ? (meta.children as Record<string, FSBChildInfo>)
      : undefined,
    edges: edges as FSBGraphMeta['edges'],
    zoom,
    pan,
    canvasBounds: canvasBounds as FSBGraphMeta['canvasBounds'],
  }
}

// ===== 工具函数 =====

const _saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const _blobUrlRegistry = new Map<string, string>()
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function normalizeName(name: unknown): string {
  return String(name || '').trim()
}

function ensureValidName(name: unknown, label = '名称'): string {
  const normalized = normalizeName(name)
  if (!normalized) throw new Error(`${label}不能为空`)
  if (normalized === '.' || normalized === '..') {
    throw new Error(`${label}不合法`)
  }
  return normalized
}

// ===== Store =====

export interface DirEntry {
  path: string
  name: string
  isDir: boolean
}

export interface DirDialogResult {
  valid: boolean
  nodePath?: string
  error?: string
}

export interface SaveImageResult {
  path: string
  markdownRef: string
}

export const Store = {
  // ===== 初始化 =====
  init() {
    try {
      return FSB.initWorkDir()
    } catch (e) {
      logger.catch('Store.init', '初始化工作目录失败', e)
      throw e
    }
  },

  setWorkDir(dirPath: string): Promise<DirDialogResult> {
    try {
      return FSB.setWorkDir(dirPath) as Promise<DirDialogResult>
    } catch (e) {
      logger.catch('Store.setWorkDir', '设置工作目录失败', e)
      throw e
    }
  },

  selectWorkDirCandidate(): Promise<DirDialogResult> {
    try {
      return FSB.selectWorkDirCandidate() as Promise<DirDialogResult>
    } catch (e) {
      logger.catch('Store.selectWorkDirCandidate', '选择工作目录候选失败', e)
      throw e
    }
  },

  createWorkDir(dirPath: string): Promise<DirDialogResult> {
    try {
      return FSB.createWorkDir(dirPath) as Promise<DirDialogResult>
    } catch (e) {
      logger.catch('Store.createWorkDir', '创建工作目录失败', e)
      throw e
    }
  },

  // ===== 知识库（根级目录） =====
  listKBs: () => FSB.listChildren(''),

  async createKB(name: unknown, meta?: unknown) {
    const safeName = ensureValidName(name, '知识库名称')
    try {
      const existing = await FSB.listChildren('')
      let maxOrder = -1
      for (const kb of existing) {
        if (Number.isFinite(kb.order) && (kb.order as number) > maxOrder) maxOrder = kb.order as number
      }
      const newOrder = maxOrder + 1
      const actualPath = await FSB.mkDir(safeName, null)
      await FSB.saveKBOrder(actualPath, newOrder)
      return actualPath || safeName
    } catch (e) {
      logger.catch('Store.createKB', `创建知识库失败: ${name}`, e)
      throw e
    }
  },

  async deleteKB(name: string) {
    try {
      return await FSB.rmDir(name)
    } catch (e) {
      logger.catch('Store.deleteKB', `删除知识库失败: ${name}`, e)
      throw e
    }
  },

  async saveKBCover(kbPath: string, coverPath: string | null) {
    try {
      return await FSB.saveKBCover(kbPath, coverPath)
    } catch (e) {
      logger.catch('Store.saveKBCover', `保存知识库封面失败: ${kbPath}`, e)
      throw e
    }
  },

  async renameKB(kbPath: string, newName: unknown) {
    const safeName = ensureValidName(newName, '知识库名称')
    try {
      return await FSB.renameKB(kbPath, safeName)
    } catch (e) {
      logger.catch('Store.renameKB', `重命名知识库失败: ${kbPath} -> ${newName}`, e)
      throw e
    }
  },

  // ===== 卡片（子目录） =====
  async listCards(parentPath: string) {
    try {
      return await FSB.listChildren(parentPath)
    } catch (e) {
      logger.catch('Store.listCards', `列出卡片失败: ${parentPath}`, e)
      throw e
    }
  },

  async createCard(parentPath: string, cardName: unknown) {
    const safeName = ensureValidName(cardName, '卡片名称')
    try {
      const basePath = parentPath || ''
      const children = await FSB.listChildren(basePath)
      const duplicated = (children || []).some((c) => (c?.name || '').trim() === safeName)
      if (duplicated) {
        throw new Error(`同级下已存在同名卡片：${safeName}`)
      }
      const cardPath = basePath ? `${basePath}/${safeName}` : safeName
      const actualPath = await FSB.mkDir(cardPath, null)
      return actualPath
    } catch (e) {
      logger.catch('Store.createCard', `创建卡片失败: ${parentPath}/${cardName}`, e)
      throw e
    }
  },

  async deleteCard(cardPath: string) {
    try {
      return await FSB.rmDir(cardPath)
    } catch (e) {
      logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e)
      throw e
    }
  },

  async renameCard(cardPath: string, newName: unknown) {
    const safeName = ensureValidName(newName, '卡片名称')
    try {
      const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
      const siblings = await FSB.listChildren(parentPath)
      const duplicated = (siblings || []).some((s) => s.path !== cardPath && (s?.name || '').trim() === safeName)
      if (duplicated) {
        throw new Error(`同级下已存在同名卡片：${safeName}`)
      }
      const newPath = await FSB.updateCardMeta(cardPath, safeName)
      return newPath || cardPath
    } catch (e) {
      logger.catch('Store.renameCard', `重命名卡片失败: ${cardPath} -> ${newName}`, e)
      throw e
    }
  },

  // ===== Markdown 文档 =====
  async readMarkdown(cardPath: string) {
    try {
      return await FSB.readFile(`${cardPath}/README.md`)
    } catch (e) {
      logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e)
      throw e
    }
  },

  async writeMarkdown(cardPath: string, content: string) {
    try {
      await FSB.ensureCardDir(cardPath)
      return await FSB.writeFile(`${cardPath}/README.md`, content)
    } catch (e) {
      logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e)
      throw e
    }
  },

  // ===== 布局 =====
  async readLayout(dirPath: string): Promise<FSBGraphMeta> {
    try {
      return normalizeMeta(await FSB.readGraphMeta(dirPath)) as FSBGraphMeta
    } catch (e) {
      logger.catch('Store.readLayout', `读取布局失败: ${dirPath}`, e)
      throw e
    }
  },

  async saveLayout(dirPath: string, meta: unknown) {
    try {
      return await FSB.writeGraphMeta(dirPath, normalizeMeta(meta))
    } catch (e) {
      logger.catch('Store.saveLayout', `保存布局失败: ${dirPath}`, e)
      throw e
    }
  },

  saveGraphDebounced(dirPath: string, buildMetaFn: () => unknown, onSaved?: () => void): Promise<void> {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) clearTimeout(oldTimer)

    let resolveRef: (() => void) | null = null
    const promise = new Promise<void>(resolve => { resolveRef = resolve })
    const timer = setTimeout(async () => {
      _saveTimers.delete(dirPath)
      const meta = buildMetaFn()
      try {
        await Store.saveLayout(dirPath, normalizeMeta(meta))
        onSaved?.()
        resolveRef?.()
      } catch (e) {
        logger.catch('Store.saveGraphDebounced', `保存布局失败: ${dirPath}`, e)
        resolveRef?.()
      }
    }, 300)

    _saveTimers.set(dirPath, timer)
    return promise
  },

  flushGraphSave(dirPath: string, buildMetaFn: () => unknown, onSaved?: () => void): Promise<void> {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) {
      clearTimeout(oldTimer)
      _saveTimers.delete(dirPath)
    }
    const meta = buildMetaFn()
    return Store.saveLayout(dirPath, normalizeMeta(meta)).then(() => onSaved?.())
  },

  // ===== 图片 =====
  async saveImage(cardPath: string, blob: Blob, filename: string): Promise<SaveImageResult> {
    if (blob.size > MAX_IMAGE_SIZE) {
      throw new Error(`图片大小超过限制（最大 5MB），当前 ${(blob.size / 1024 / 1024).toFixed(1)}MB`)
    }
    const imgPath = `${cardPath}/images/${filename}`
    try {
      const buffer = await blob.arrayBuffer()
      await FSB.writeBlobFile(imgPath, buffer)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  async saveKBImage(kbPath: string, blob: Blob, filename: string): Promise<SaveImageResult> {
    if (blob.size > MAX_IMAGE_SIZE) {
      throw new Error(`图片大小超过限制（最大 5MB），当前 ${(blob.size / 1024 / 1024).toFixed(1)}MB`)
    }
    const imgPath = `${kbPath}/images/${filename}`
    try {
      const buffer = await blob.arrayBuffer()
      await FSB.writeBlobFile(imgPath, buffer)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveKBImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  async loadImage(imgPath: string): Promise<string> {
    try {
      const buffer = await FSB.readBlobFile(imgPath)
      if (!buffer) return ''
      const existing = _blobUrlRegistry.get(imgPath)
      if (existing) {
        try { URL.revokeObjectURL(existing) } catch (e) { logger.warn('Store', `revokeImageUrl ${imgPath}`, e) }
        _blobUrlRegistry.delete(imgPath)
      }
      const url = URL.createObjectURL(new Blob([buffer]))
      _blobUrlRegistry.set(imgPath, url)
      return url
    } catch (e) {
      logger.catch('Store.loadImage', `加载图片失败: ${imgPath}`, e)
      throw e
    }
  },

  revokeAllImageUrls(): void {
    for (const [path, url] of _blobUrlRegistry) {
      try { URL.revokeObjectURL(url) } catch (e) { logger.warn('Store', `revokeImageUrl ${path}`, e) }
    }
    _blobUrlRegistry.clear()
  },

  // ===== 工具 =====
  async clearAll() {
    try {
      return await FSB.clearAll()
    } catch (e) {
      logger.catch('Store.clearAll', '清除所有数据失败', e)
      throw e
    }
  },

  async importKB(sourcePath: string) {
    try {
      return await FSB.importKB(sourcePath)
    } catch (e) {
      logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e)
      throw e
    }
  },

  async openInFinder(p: string) {
    try {
      return await FSB.openInFinder(p)
    } catch (e) {
      logger.catch('Store.openInFinder', `打开目录失败: ${p}`, e)
      throw e
    }
  },

  async countChildren(p: string) {
    try {
      return await FSB.countChildren(p)
    } catch (e) {
      logger.catch('Store.countChildren', `统计子节点失败: ${p}`, e)
      throw e
    }
  },

  getRootDir() {
    try {
      return FSB.getRootDir()
    } catch (e) {
      logger.catch('Store.getRootDir', '获取根目录失败', e)
      throw e
    }
  },

  getLastOpenedKB() {
    try {
      return FSB.getLastOpenedKB()
    } catch (e) {
      logger.catch('Store.getLastOpenedKB', '获取上次打开的知识库失败', e)
      throw e
    }
  },

  setLastOpenedKB(kbPath: string | null) {
    try {
      return FSB.setLastOpenedKB(kbPath)
    } catch (e) {
      logger.catch('Store.setLastOpenedKB', `设置上次打开的知识库失败: ${kbPath}`, e)
      throw e
    }
  },

  ensureCardDir(cardPath: string) {
    try {
      return FSB.ensureCardDir(cardPath)
    } catch (e) {
      logger.catch('Store.ensureCardDir', `确保目录存在失败: ${cardPath}`, e)
      throw e
    }
  },
}
