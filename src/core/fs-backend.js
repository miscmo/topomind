import { logger } from './logger.js'

/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
/**
 * 获取预加载脚本注入的 Electron IPC API。
 *
 * @returns {typeof window.electronAPI | undefined} Electron API 对象
 */
const getApi = () => window.electronAPI

/**
 * 统一封装渲染进程到主进程的 IPC 调用。
 * 当 API 尚未就绪时会记录日志并返回 rejected Promise。
 *
 * @param {string} channel IPC 通道名
 * @param {...any} args 传递给主进程的参数
 * @returns {Promise<any>} IPC 调用结果
 */
const _call = (channel, ...args) => {
  const api = getApi()
  if (!api) {
    logger.catch('FSB', `IPC API 未就绪，无法调用 ${channel}`)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

export const FSB = {
  // ===== 工作目录与基础操作 =====
  /** 初始化文件系统工作目录（兼容历史入口）。 */
  open: () => _call('fs:init'),
  /** 清空当前工作目录下的业务数据。 */
  clearAll: () => _call('fs:clearAll'),
  /** 初始化文件系统工作目录。 */
  initWorkDir: () => _call('fs:init'),

  // ===== 目录与元数据 =====
  /** 列出指定父路径下的子目录信息。 */
  listChildren: (parentPath) => _call('fs:listChildren', parentPath),
  /** 创建目录并按需初始化默认图元数据。 */
  mkDir: (dirPath, meta) => _call('fs:mkDir', dirPath, meta || {}),
  /** 删除指定目录及其内容。 */
  rmDir: (dirPath) => _call('fs:rmDir', dirPath),
  /** 保存知识库排序值。 */
  saveKBOrder: (kbPath, order) => _call('fs:saveKBOrder', kbPath, order),
  /** 读取知识库封面配置。 */
  getKBCover: (kbPath) => _call('fs:getKBCover', kbPath),
  /** 保存知识库封面配置。 */
  saveKBCover: (kbPath, coverPath) => _call('fs:saveKBCover', kbPath, coverPath),
  /** 重命名知识库目录。 */
  renameKB: (kbPath, newName) => _call('fs:renameKB', kbPath, newName),
  /** 读取目录对应的图元数据。 */
  readGraphMeta: (dirPath) => _call('fs:readGraphMeta', dirPath),
  /** 写入目录对应的图元数据。 */
  writeGraphMeta: (dirPath, meta) => _call('fs:writeGraphMeta', dirPath, meta),
  /** 查询目录是否存在。 */
  getDir: (dirPath) => _call('fs:getDir', dirPath),
  /** 更新父级图元数据中的卡片显示名称。 */
  updateCardMeta: (cardPath, newName) => _call('fs:updateCardMeta', cardPath, newName),

  // ===== 文本文件操作 =====
  /** 读取 UTF-8 文本文件。 */
  readFile: (filePath) => _call('fs:readFile', filePath),
  /** 写入 UTF-8 文本文件。 */
  writeFile: (filePath, content) => _call('fs:writeFile', filePath, content),
  /** 删除指定文本文件。 */
  deleteFile: (filePath) => _call('fs:deleteFile', filePath),

  // ===== 二进制文件操作 =====
  /** 将 Blob 写入主进程文件系统。 */
  writeBlobFile: (filePath, blob) =>
    blob.arrayBuffer().then(ab => _call('fs:writeBlobFile', filePath, ab)),
  /** 从主进程读取二进制文件并转换为 Blob。 */
  readBlobFile: (filePath) =>
    _call('fs:readBlobFile', filePath).then(ab => ab ? new Blob([ab]) : null),

  // ===== 工作目录辅助能力 =====
  /** 选择已有工作目录。 */
  selectExistingWorkDir: (dirPath) => _call('fs:selectExistingWorkDir', dirPath),
  /** 确保卡片目录存在。 */
  ensureCardDir: (cardPath) => _call('fs:ensureCardDir', cardPath),
  /** 打开系统目录选择器选择工作目录。 */
  selectWorkDirCandidate: () => _call('fs:selectWorkDirCandidate'),
  /** 创建新的工作目录。 */
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath),
  /** 导入已有知识库。 */
  importKB: (sourcePath) => _call('fs:importKB', sourcePath),
  /** 在系统文件管理器中打开指定路径。 */
  openInFinder: (p) => _call('fs:openInFinder', p),
  /** 统计子目录数量。 */
  countChildren: (p) => _call('fs:countChildren', p),
  /** 获取当前工作目录。 */
  getRootDir: () => _call('fs:getRootDir'),
  /** 获取上次打开的知识库路径。 */
  getLastOpenedKB: () => _call('fs:getLastOpenedKB'),
  /** 设置上次打开的知识库路径。 */
  setLastOpenedKB: (kbPath) => _call('fs:setLastOpenedKB', kbPath),
}
