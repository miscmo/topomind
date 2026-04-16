/**
 * 统一存储适配器（Electron 桌面端专用）ES Module 版本
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend.js'
import { normalizeMeta } from './meta.js'

const _saveTimers = new Map()

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
    return FSB.initWorkDir()
  },
  selectExistingWorkDir(dirPath) {
    return FSB.selectExistingWorkDir(dirPath)
  },
  selectWorkDirCandidate() {
    return FSB.selectWorkDirCandidate()
  },
  createWorkDir(dirPath) {
    return FSB.createWorkDir(dirPath)
  },

  // ===== 知识库（根级目录） =====
  listKBs: () => FSB.listChildren(''),

  async createKB(name, meta) {
    const safeName = ensureValidName(name, '知识库名称')
    const existing = await FSB.listChildren('')
    let maxOrder = -1
    for (const kb of existing) {
      if (Number.isFinite(kb.order) && kb.order > maxOrder) maxOrder = kb.order
    }
    const newOrder = maxOrder + 1
    // Create directory (only creates _graph.json)
    const actualPath = await FSB.mkDir(safeName, null)
    // Write name to KB's _graph.json and save order to _config.json.orders
    await FSB.writeKBName(actualPath, safeName)
    await FSB.saveKBOrder(actualPath, newOrder)
    return actualPath || safeName
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
    // 惰性创建：目录在写入文档、添加子节点或进入房间时才会被创建
    // 卡片路径通过 saveLayoutDebounced 被添加到父级的 children map 中
    return cardPath
  },

  deleteCard: (cardPath) => FSB.rmDir(cardPath),

  async renameCard(cardPath, newName) {
    const safeName = ensureValidName(newName, '卡片名称')
    const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
    const siblings = await FSB.listChildren(parentPath)
    const duplicated = (siblings || []).some((s) => s.path !== cardPath && (s?.name || '').trim() === safeName)
    if (duplicated) {
      throw new Error(`同级下已存在同名卡片：${safeName}`)
    }

    // Update parent's _graph.json and rename the directory
    const newPath = await FSB.updateCardMeta(cardPath, safeName)
    return newPath || cardPath
  },

  // ===== Markdown 文档 =====
  readMarkdown: (cardPath) => FSB.readFile(`${cardPath}/README.md`),
  writeMarkdown: (cardPath, content) => {
    // 惰性创建：首次写入文档时创建目录
    return FSB.ensureCardDir(cardPath).then(() =>
      FSB.writeFile(`${cardPath}/README.md`, content)
    )
  },

  // ===== 关系和布局 =====
  readLayout(dirPath) {
    return FSB.readGraphMeta(dirPath).then(normalizeMeta)
  },
  saveLayout: (dirPath, meta) => FSB.writeGraphMeta(dirPath, normalizeMeta(meta)),

  saveGraphDebounced(dirPath, buildMetaFn, onSaved) {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) clearTimeout(oldTimer)

    let resolveRef = null
    const promise = new Promise(resolve => { resolveRef = resolve })
    const timer = setTimeout(() => {
      _saveTimers.delete(dirPath)
      const meta = buildMetaFn()
      Store.saveLayout(dirPath, normalizeMeta(meta)).then(() => {
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
    return Store.saveLayout(dirPath, normalizeMeta(meta)).then(() => onSaved?.())
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
  importKB: (sourcePath) => FSB.importKB(sourcePath),
  openInFinder: (p) => FSB.openInFinder(p),
  countChildren: (p) => FSB.countChildren(p),
  getRootDir: () => FSB.getRootDir(),
  getLastOpenedKB: () => FSB.getLastOpenedKB(),
  setLastOpenedKB: (kbPath) => FSB.setLastOpenedKB(kbPath),

  // 惰性目录创建
  ensureCardDir: (cardPath) => FSB.ensureCardDir(cardPath),
}
