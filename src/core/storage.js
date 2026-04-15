/**
 * 统一存储适配器（Electron 桌面端专用）ES Module 版本
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend.js'

const _saveTimers = new Map()

const INVALID_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/

function normalizeName(name) {
  return String(name || '').trim()
}

function ensureValidName(name, label = '名称') {
  const normalized = normalizeName(name)
  if (!normalized) throw new Error(`${label}不能为空`)
  if (normalized === '.' || normalized === '..') {
    throw new Error(`${label}不合法`)
  }
  return normalized
}

export const Store = {
  // ===== 初始化 =====
  init() {
    console.log('[Store] 初始化 FSB 后端')
    return FSB.open().then(r => {
      console.log('[Store] 初始化完成:', r)
      return r
    })
  },

  // ===== 知识库（根级目录） =====
  listKBs: () => FSB.listChildren(''),

  createKB(name, meta) {
    const safeName = ensureValidName(name, '知识库名称')
    const fullMeta = Object.assign({ name: safeName, createdAt: Date.now(), cover: '' }, meta || {})
    return FSB.mkDir(safeName, fullMeta)
  },

  deleteKB: (name) => FSB.rmDir(name),
  getKBMeta: (name) => FSB.readMeta(name),
  saveKBMeta: (name, meta) => FSB.writeMeta(name, meta),

  // ===== 卡片（子目录） =====
  listCards: (parentPath) => FSB.listChildren(parentPath),

  async createCard(parentPath, cardName) {
    const safeName = ensureValidName(cardName, '卡片名称')
    const basePath = parentPath || ''
    const children = await FSB.listChildren(basePath)
    const duplicated = (children || []).some((c) => (c?.name || '').trim() === safeName)
    if (duplicated) {
      throw new Error(`同级下已存在同名卡片：${safeName}`)
    }

    const cardPath = basePath ? `${basePath}/${safeName}` : safeName
    const fullMeta = { name: safeName, createdAt: Date.now(), children: {}, edges: [] }
    const actualPath = await FSB.mkDir(cardPath, fullMeta)
    return actualPath || cardPath
  },

  deleteCard: (cardPath) => FSB.rmDir(cardPath),

  async renameCard(cardPath, newName) {
    const safeName = ensureValidName(newName, '卡片名称')
    const dir = await FSB.getDir(cardPath)
    if (!dir) return

    const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
    const siblings = await FSB.listChildren(parentPath)
    const duplicated = (siblings || []).some((s) => s.path !== cardPath && (s?.name || '').trim() === safeName)
    if (duplicated) {
      throw new Error(`同级下已存在同名卡片：${safeName}`)
    }

    dir.name = safeName
    const actualPath = await FSB.mkDir(cardPath, dir)
    return actualPath || cardPath
  },

  // ===== Markdown 文档 =====
  readMarkdown: (cardPath) => FSB.readFile(`${cardPath}/README.md`),
  writeMarkdown: (cardPath, content) => FSB.writeFile(`${cardPath}/README.md`, content),

  // ===== 关系和布局 =====
  readLayout: (dirPath) => FSB.readGraphMeta(dirPath),
  saveLayout: (dirPath, meta) => FSB.writeGraphMeta(dirPath, meta),

  saveGraphDebounced(dirPath, buildMetaFn, onSaved) {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) clearTimeout(oldTimer)

    let resolveRef = null
    const promise = new Promise(resolve => { resolveRef = resolve })
    const timer = setTimeout(() => {
      _saveTimers.delete(dirPath)
      const meta = buildMetaFn()
      Store.saveLayout(dirPath, meta).then(() => {
        onSaved?.()
        resolveRef()
      })
    }, 300)

    _saveTimers.set(dirPath, timer)
    return promise
  },

  flushGraphSave(dirPath, buildMetaFn, onSaved) {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) {
      clearTimeout(oldTimer)
      _saveTimers.delete(dirPath)
    }
    const meta = buildMetaFn()
    return Store.saveLayout(dirPath, meta).then(() => onSaved?.())
  },

  // ===== 图片 =====
  saveImage(cardPath, blob, filename) {
    const imgPath = `${cardPath}/images/${filename}`
    return FSB.writeBlobFile(imgPath, blob).then(() => ({
      path: imgPath,
      markdownRef: `images/${filename}`,
    }))
  },

  saveKBImage(kbPath, blob, filename) {
    const imgPath = `${kbPath}/images/${filename}`
    return FSB.writeBlobFile(imgPath, blob).then(() => ({
      path: imgPath,
      markdownRef: `images/${filename}`,
    }))
  },

  loadImage(imgPath) {
    return FSB.readBlobFile(imgPath).then(blob =>
      blob ? URL.createObjectURL(blob) : ''
    )
  },

  // ===== 工具 =====
  clearAll: () => FSB.clearAll(),
  selectExistingKB: () => FSB.selectExistingKB(),
  importKB: (sourcePath) => FSB.importKB(sourcePath),
  openInFinder: (p) => FSB.openInFinder(p),
  countChildren: (p) => FSB.countChildren(p),
  getRootDir: () => FSB.getRootDir(),
  getLastOpenedKB: () => FSB.getLastOpenedKB(),
  setLastOpenedKB: (kbPath) => FSB.setLastOpenedKB(kbPath),
}
