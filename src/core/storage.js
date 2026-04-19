/**
 * 统一存储适配器（Electron 桌面端专用）ES Module 版本
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend.js'
import { normalizeMeta } from './meta.js'
import { logger } from './logger.js'

const _saveTimers = new Map()
/** 追踪 loadImage 创建的 Blob URL，防止内存泄漏 */
const _blobUrlRegistry = new Map()
/** 单张图片最大尺寸：5MB */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * 规范化用户输入名称，统一转为去除首尾空格的字符串。
 *
 * @param {string} name 原始名称
 * @returns {string} 规范化后的名称
 */
function normalizeName(name) {
  return String(name || '').trim()
}

/**
 * 校验名称是否合法，禁止空名称以及 `.`、`..`。
 *
 * @param {string} name 原始名称
 * @param {string} [label='名称'] 字段标签，用于错误提示
 * @returns {string} 校验通过后的名称
 * @throws {Error} 当名称为空或不合法时抛出异常
 */
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
  /**
   * 初始化当前工作目录。
   *
   * @returns {Promise<object>} 工作目录初始化结果
   */
  init() {
    try {
      return FSB.initWorkDir()
    } catch (e) {
      logger.catch('Store.init', '初始化工作目录失败', e)
      throw e
    }
  },
  /**
   * 选择并校验一个已有工作目录。
   *
   * @param {string} dirPath 工作目录路径
   * @returns {Promise<object>} 工作目录选择结果
   */
  selectExistingWorkDir(dirPath) {
    try {
      return FSB.selectExistingWorkDir(dirPath)
    } catch (e) {
      logger.catch('Store.selectExistingWorkDir', '选择已存在的工作目录失败', e)
      throw e
    }
  },
  /**
   * 打开目录选择器，选择一个工作目录候选路径。
   *
   * @returns {Promise<object>} 目录选择结果
   */
  selectWorkDirCandidate() {
    try {
      return FSB.selectWorkDirCandidate()
    } catch (e) {
      logger.catch('Store.selectWorkDirCandidate', '选择工作目录候选失败', e)
      throw e
    }
  },

  /**
   * 创建新的工作目录。
   *
   * @param {string} dirPath 工作目录路径
   * @returns {Promise<object>} 工作目录创建结果
   */
  createWorkDir(dirPath) {
    try {
      return FSB.createWorkDir(dirPath)
    } catch (e) {
      logger.catch('Store.createWorkDir', '创建工作目录失败', e)
      throw e
    }
  },

  // ===== 知识库（根级目录） =====
  /**
   * 获取根目录下的知识库列表。
   *
   * @returns {Promise<Array<object>>} 知识库列表
   */
  listKBs: () => FSB.listChildren(''),

  /**
   * 创建一个新的知识库目录，并为其分配排序值。
   *
   * @param {string} name 知识库名称
   * @param {object} meta 当前未使用，预留参数
   * @returns {Promise<string>} 新知识库相对路径
   */
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
      await FSB.saveKBOrder(actualPath, newOrder)
      return actualPath || safeName
    } catch (e) {
      logger.catch('Store.createKB', `创建知识库失败: ${name}`, e)
      throw e
    }
  },

  /**
   * 删除指定知识库目录。
   *
   * @param {string} name 知识库相对路径
   * @returns {Promise<void>} 删除结果
   */
  async deleteKB(name) {
    try {
      return await FSB.rmDir(name)
    } catch (e) {
      logger.catch('Store.deleteKB', `删除知识库失败: ${name}`, e)
      throw e
    }
  },

  /**
   * 保存知识库封面路径配置。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string|null} coverPath 封面相对路径
   * @returns {Promise<void>} 保存结果
   */
  async saveKBCover(kbPath, coverPath) {
    try {
      return await FSB.saveKBCover(kbPath, coverPath)
    } catch (e) {
      logger.catch('Store.saveKBCover', `保存知识库封面失败: ${kbPath}`, e)
      throw e
    }
  },

  /**
   * 重命名知识库。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string} newName 新名称
   * @returns {Promise<string>} 重命名后的相对路径
   */
  async renameKB(kbPath, newName) {
    const safeName = ensureValidName(newName, '知识库名称')
    try {
      return await FSB.renameKB(kbPath, safeName)
    } catch (e) {
      logger.catch('Store.renameKB', `重命名知识库失败: ${kbPath} -> ${newName}`, e)
      throw e
    }
  },

  // ===== 卡片（子目录） =====
  /**
   * 列出指定父路径下的卡片列表。
   *
   * @param {string} parentPath 父级相对路径
   * @returns {Promise<Array<object>>} 卡片列表
   */
  async listCards(parentPath) {
    try {
      return await FSB.listChildren(parentPath)
    } catch (e) {
      logger.catch('Store.listCards', `列出卡片失败: ${parentPath}`, e)
      throw e
    }
  },

  /**
   * 在指定父路径下创建卡片，并校验同级名称不能重复。
   *
   * @param {string} parentPath 父级相对路径
   * @param {string} cardName 卡片名称
   * @returns {Promise<string>} 新卡片相对路径
   */
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
      const actualPath = await FSB.mkDir(cardPath, null)
      return actualPath
    } catch (e) {
      logger.catch('Store.createCard', `创建卡片失败: ${parentPath}/${cardName}`, e)
      throw e
    }
  },

  /**
   * 删除指定卡片目录。
   *
   * @param {string} cardPath 卡片相对路径
   * @returns {Promise<void>} 删除结果
   */
  async deleteCard(cardPath) {
    try {
      return await FSB.rmDir(cardPath)
    } catch (e) {
      logger.catch('Store.deleteCard', `删除卡片失败: ${cardPath}`, e)
      throw e
    }
  },

  /**
   * 重命名卡片显示名称，不改变目录路径，仅更新元数据。
   *
   * @param {string} cardPath 卡片相对路径
   * @param {string} newName 新名称
   * @returns {Promise<string>} 更新后的卡片路径
   */
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
  /**
   * 读取卡片目录下的 Markdown 文档内容。
   *
   * @param {string} cardPath 卡片相对路径
   * @returns {Promise<string>} Markdown 内容
   */
  async readMarkdown(cardPath) {
    try {
      return await FSB.readFile(`${cardPath}/README.md`)
    } catch (e) {
      logger.catch('Store.readMarkdown', `读取文档失败: ${cardPath}`, e)
      throw e
    }
  },

  /**
   * 写入卡片目录下的 Markdown 文档，必要时自动创建目录。
   *
   * @param {string} cardPath 卡片相对路径
   * @param {string} content Markdown 内容
   * @returns {Promise<void>} 写入结果
   */
  async writeMarkdown(cardPath, content) {
    try {
      await FSB.ensureCardDir(cardPath)
      return await FSB.writeFile(`${cardPath}/README.md`, content)
    } catch (e) {
      logger.catch('Store.writeMarkdown', `写入文档失败: ${cardPath}`, e)
      throw e
    }
  },

  /**
   * 读取目录布局元数据，并进行标准化处理。
   *
   * @param {string} dirPath 目录相对路径
   * @returns {Promise<object>} 标准化后的布局数据
   */
  async readLayout(dirPath) {
    try {
      return normalizeMeta(await FSB.readGraphMeta(dirPath))
    } catch (e) {
      logger.catch('Store.readLayout', `读取布局失败: ${dirPath}`, e)
      throw e
    }
  },

  /**
   * 保存目录布局元数据，并在写入前做标准化处理。
   *
   * @param {string} dirPath 目录相对路径
   * @param {object} meta 布局元数据
   * @returns {Promise<void>} 保存结果
   */
  async saveLayout(dirPath, meta) {
    try {
      return await FSB.writeGraphMeta(dirPath, normalizeMeta(meta))
    } catch (e) {
      logger.catch('Store.saveLayout', `保存布局失败: ${dirPath}`, e)
      throw e
    }
  },

  /**
   * 以防抖方式保存图布局，适合拖拽和连续编辑场景。
   * 同一路径的上一次延迟保存会被新的请求覆盖。
   *
   * @param {string} dirPath 目标目录路径
   * @param {() => object} buildMetaFn 用于构建最新图元数据的函数
   * @param {() => void} [onSaved] 保存成功后的回调
   * @returns {Promise<void>} 保存完成 Promise
   */
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

  /**
   * 立即执行挂起中的图布局保存，并清除对应的防抖计时器。
   *
   * @param {string} dirPath 目标目录路径
   * @param {() => object} buildMetaFn 用于构建最新图元数据的函数
   * @param {() => void} [onSaved] 保存成功后的回调
   * @returns {Promise<void>} 保存完成 Promise
   */
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
  /**
   * 保存卡片图片，并返回可写入 Markdown 的相对引用。
   *
   * @param {string} cardPath 卡片相对路径
   * @param {Blob} blob 图片二进制内容
   * @param {string} filename 文件名
   * @returns {Promise<{path: string, markdownRef: string}>} 图片路径信息
   * @throws {Error} 当图片体积超过限制时抛出异常
   */
  async saveImage(cardPath, blob, filename) {
    if (blob.size > MAX_IMAGE_SIZE) {
      throw new Error(`图片大小超过限制（最大 5MB），当前 ${(blob.size / 1024 / 1024).toFixed(1)}MB`)
    }
    const imgPath = `${cardPath}/images/${filename}`
    try {
      await FSB.writeBlobFile(imgPath, blob)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  /**
   * 保存知识库级图片，并返回可用于引用的路径信息。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {Blob} blob 图片二进制内容
   * @param {string} filename 文件名
   * @returns {Promise<{path: string, markdownRef: string}>} 图片路径信息
   * @throws {Error} 当图片体积超过限制时抛出异常
   */
  async saveKBImage(kbPath, blob, filename) {
    if (blob.size > MAX_IMAGE_SIZE) {
      throw new Error(`图片大小超过限制（最大 5MB），当前 ${(blob.size / 1024 / 1024).toFixed(1)}MB`)
    }
    const imgPath = `${kbPath}/images/${filename}`
    try {
      await FSB.writeBlobFile(imgPath, blob)
      return { path: imgPath, markdownRef: `images/${filename}` }
    } catch (e) {
      logger.catch('Store.saveKBImage', `保存图片失败: ${imgPath}`, e)
      throw e
    }
  },

  /**
   * 加载图片并转换为可在浏览器中使用的 Blob URL。
   * 若同一路径此前已生成过 URL，会先撤销旧 URL 以避免泄漏。
   *
   * @param {string} imgPath 图片相对路径
   * @returns {Promise<string>} Blob URL；图片不存在时返回空字符串
   */
  async loadImage(imgPath) {
    try {
      const blob = await FSB.readBlobFile(imgPath)
      if (!blob) return ''
      // 先撤销旧 URL（同一路径可能多次调用）
      const existing = _blobUrlRegistry.get(imgPath)
      if (existing) {
        try { URL.revokeObjectURL(existing) } catch (e) { logger.warn('Store', `revokeImageUrl ${imgPath}`, e) }
        _blobUrlRegistry.delete(imgPath)
      }
      const url = URL.createObjectURL(blob)
      _blobUrlRegistry.set(imgPath, url)
      return url
    } catch (e) {
      logger.catch('Store.loadImage', `加载图片失败: ${imgPath}`, e)
      throw e
    }
  },

  /**
   * 撤销所有由 `loadImage` 创建的 Blob URL。
   * 通常在列表刷新或页面卸载时调用，用于释放浏览器内存。
   *
   * @returns {void}
   */
  revokeAllImageUrls() {
    for (const [path, url] of _blobUrlRegistry) {
      try { URL.revokeObjectURL(url) } catch (e) { logger.warn('Store', `revokeImageUrl ${path}`, e) }
    }
    _blobUrlRegistry.clear()
  },

  // ===== 工具 =====
  /**
   * 清空当前工作目录下的全部业务数据。
   *
   * @returns {Promise<void>} 清空结果
   */
  async clearAll() {
    try {
      return await FSB.clearAll()
    } catch (e) {
      logger.catch('Store.clearAll', '清除所有数据失败', e)
      throw e
    }
  },

  /**
   * 导入一个已存在的知识库目录到当前工作目录。
   *
   * @param {string} sourcePath 源知识库目录路径
   * @returns {Promise<string>} 导入后的知识库相对路径
   */
  async importKB(sourcePath) {
    try {
      return await FSB.importKB(sourcePath)
    } catch (e) {
      logger.catch('Store.importKB', `导入知识库失败: ${sourcePath}`, e)
      throw e
    }
  },

  /**
   * 在系统文件管理器中打开指定路径。
   *
   * @param {string} p 相对路径或绝对路径
   * @returns {Promise<void>} 打开结果
   */
  async openInFinder(p) {
    try {
      return await FSB.openInFinder(p)
    } catch (e) {
      logger.catch('Store.openInFinder', `打开目录失败: ${p}`, e)
      throw e
    }
  },

  /**
   * 统计指定路径下的直接子目录数量。
   *
   * @param {string} p 相对路径
   * @returns {Promise<number>} 子目录数量
   */
  async countChildren(p) {
    try {
      return await FSB.countChildren(p)
    } catch (e) {
      logger.catch('Store.countChildren', `统计子节点失败: ${p}`, e)
      throw e
    }
  },

  /**
   * 获取当前工作目录路径。
   *
   * @returns {Promise<string>} 工作目录路径
   */
  getRootDir() {
    try {
      return FSB.getRootDir()
    } catch (e) {
      logger.catch('Store.getRootDir', '获取根目录失败', e)
      throw e
    }
  },

  /**
   * 获取上次打开的知识库路径。
   *
   * @returns {Promise<string|null>} 知识库路径
   */
  getLastOpenedKB() {
    try {
      return FSB.getLastOpenedKB()
    } catch (e) {
      logger.catch('Store.getLastOpenedKB', '获取上次打开的知识库失败', e)
      throw e
    }
  },

  /**
   * 记录上次打开的知识库路径。
   *
   * @param {string|null} kbPath 知识库路径
   * @returns {Promise<void>} 设置结果
   */
  setLastOpenedKB(kbPath) {
    try {
      return FSB.setLastOpenedKB(kbPath)
    } catch (e) {
      logger.catch('Store.setLastOpenedKB', `设置上次打开的知识库失败: ${kbPath}`, e)
      throw e
    }
  },

  /**
   * 确保卡片目录存在，必要时自动创建。
   *
   * @param {string} cardPath 卡片相对路径
   * @returns {Promise<void>} 处理结果
   */
  ensureCardDir(cardPath) {
    try {
      return FSB.ensureCardDir(cardPath)
    } catch (e) {
      logger.catch('Store.ensureCardDir', `确保目录存在失败: ${cardPath}`, e)
      throw e
    }
  },
}
