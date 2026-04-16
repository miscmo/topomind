/**
 * 统一存储适配器（Electron 桌面端专用）ES Module 版本
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend.js'
import { normalizeMeta } from './meta.js'
import { logger } from './logger.js'

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
    try {
      return FSB.initWorkDir()
    } catch (e) {
      logger.catch('Store.init', '初始化工作目录失败', e)
      throw e
    }
  },
  selectExistingWorkDir(dirPath) {
    try {
      return FSB.selectExistingWorkDir(dirPath)
    } catch (e) {
      logger.catch('Store.selectExistingWorkDir', '选择已存在的工作目录失败', e)
      throw e
    }
  },
  selectWorkDirCandidate() {
    try {
      return FSB.selectWorkDirCandidate()
    } catch (e) {
      logger.catch('Store.selectWorkDirCandidate', '选择工作目录候选失败', e)
      throw e
    }
  },
  createWorkDir(dirPath) {
    try {
      return FSB.createWorkDir(dirPath)
    } catch (e) {
      logger.catch('Store.createWorkDir', '创建工作目录失败', e)
      throw e
    }
  },

  // ===== 知识库（根级目录） =====
  listKBs: () => FSB.listChildren(''),

  async createKB(name, meta) {
    const safeName = ensureValidName(name, '知识库名称')
    try {
      const existing = await FSB.listChildren('')
      let maxOrder = -1
      for (const kb of existing) {
        if (Number.isFinite(kb.order) && kb.order > maxOrder) maxOrder = kb.order
      }
      const newOrder = maxOrder + 1
      const actualPath = await FSB.mkDir(safeName, null)
      await FSB.writeKBName(actualPath, safeName)
      await FSB.saveKBOrder(actualPath, newOrder)
      return actualPath || safeName
    } catch (e) {
      logger.catch('Store.createKB', `创建知识库失败: ${name}`, e)
      throw e
    }
  },

  async deleteKB(name) {
    try {
      return await FSB.rmDir(name)
    } catch (e) {
      logger.catch('Store.deleteKB', `删除知识库失败: ${name}`, e)
      throw e
    }
  },

  async getKBMeta(name) {
    try {
      return await FSB.readMeta(name)
    } catch (e) {
      logger.catch('Store.getKBMeta', `读取知识库元数据失败: ${name}`, e)
      throw e
    }
  },

  async saveKBMeta(name, meta) {
    try {
      return await FSB.writeMeta(name, meta)
    } catch (e) {
      logger.catch('Store.saveKBMeta', `保存知识库元数据失败: ${name}`, e)
      throw e
    }
  },

  // ===== 卡片（子目录） =====
  async listCards(parentPath) {
    try {
      return await FSB.listChildren(parentPath)
    } catch (e) {
      logger.catch('Store.listCards', `列出卡片失败: ${parentPath}`, e)
      throw e
    }
  },

  async createCard(parentPath, cardName) {
    const safeName = ensureValidName(cardName, '卡片名称')
    try {
      const basePath = parentPath || ''
      const children = await FSB.listChildren(basePath)
      const duplicated = (children || []).some((c) => (c?.name || '').trim() === safeName)
      if (duplicated) {
        throw new Error(`同级下已存在同名卡片：${safeName}`)
      }
      const cardPath = basePath ? `${basePath}/${safeName}` : safeName
      return cardPath
    } catch (e) {
      logger.catch('Store.createCard', `创建卡片失败: ${parentPath}/${cardName}`, e)
      throw e
    }
  },

  async deleteCard(cardPath) {
    try {
      return await FSB.rmDir(cardPath)
    } catch (e) {
      logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e)
      throw e
    }
  },

  async renameCard(cardPath, newName) {
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
  async readMarkdown(cardPath) {
    try {
      return await FSB.readFile(`${cardPath}/README.md`)
    } catch (e) {
      logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e)
      throw e
    }
  },

  async writeMarkdown(cardPath, content) {
    try {
      await FSB.ensureCardDir(cardPath)
      return await FSB.writeFile(`${cardPath}/README.md`, content)
    } catch (e) {
      logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e)
      throw e
    }
  },

  async readLayout(dirPath) {
    try {
      return normalizeMeta(await FSB.readGraphMeta(dirPath))
    } catch (e) {
      logger.catch('Store.readLayout', `读取布局失败: ${dirPath}`, e)
      throw e
    }
  },

  async saveLayout(dirPath, meta) {
    try {
      return await FSB.writeGraphMeta(dirPath, normalizeMeta(meta))
    } catch (e) {
      logger.catch('Store.saveLayout', `保存布局失败: ${dirPath}`, e)
      throw e
    }
  },

  saveGraphDebounced(dirPath, buildMetaFn, onSaved) {
    if (!dirPath) return Promise.resolve()
    const oldTimer = _saveTimers.get(dirPath)
    if (oldTimer) clearTimeout(oldTimer)

    let resolveRef = null
    const promise = new Promise(resolve => { resolveRef = resolve })
    const timer = setTimeout(async () => {
      _saveTimers.delete(dirPath)
      const meta = buildMetaFn()
      try {
        await Store.saveLayout(dirPath, normalizeMeta(meta))
        onSaved?.()
        resolveRef()
      } catch (e) {
        logger.catch('Store.saveGraphDebounced', `保存布局失败: ${dirPath}`, e)
        resolveRef()
      }
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
  async saveImage(cardPath, blob, filename) {
    const imgPath = `${cardPath}/images/${filename}`
    try {
      await FSB.writeBlobFile(imgPath, blob)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  async saveKBImage(kbPath, blob, filename) {
    const imgPath = `${kbPath}/images/${filename}`
    try {
      await FSB.writeBlobFile(imgPath, blob)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveKBImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  async loadImage(imgPath) {
    try {
      const blob = await FSB.readBlobFile(imgPath)
      return blob ? URL.createObjectURL(blob) : ''
    } catch (e) {
      logger.catch('Store.loadImage', `加载图片失败: ${imgPath}`, e)
      throw e
    }
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

  async importKB(sourcePath) {
    try {
      return await FSB.importKB(sourcePath)
    } catch (e) {
      logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e)
      throw e
    }
  },

  async openInFinder(p) {
    try {
      return await FSB.openInFinder(p)
    } catch (e) {
      logger.catch('Store.openInFinder', `打开目录失败: ${p}`, e)
      throw e
    }
  },

  async countChildren(p) {
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

  setLastOpenedKB(kbPath) {
    try {
      return FSB.setLastOpenedKB(kbPath)
    } catch (e) {
      logger.catch('Store.setLastOpenedKB', `设置上次打开的知识库失败: ${kbPath}`, e)
      throw e
    }
  },

  ensureCardDir(cardPath) {
    try {
      return FSB.ensureCardDir(cardPath)
    } catch (e) {
      logger.catch('Store.ensureCardDir', `确保目录存在失败: ${cardPath}`, e)
      throw e
    }
  },
}
