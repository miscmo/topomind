import { logger } from './logger.js'

/**
 * Git IPC 前端调用封装 - ES Module 版本
 */
/**
 * 获取预加载脚本注入的 Electron IPC API。
 *
 * @returns {typeof window.electronAPI | undefined} Electron API 对象
 */
const getApi = () => window.electronAPI

/**
 * 空安全的 IPC 调用封装。
 * 与 `fs-backend.js` 保持一致，防止 `electronAPI` 未就绪时抛出异常。
 *
 * @param {string} channel IPC 通道名
 * @param {...any} args 传递给主进程的参数
 * @returns {Promise<any>} IPC 调用结果
 */
const _call = (channel, ...args) => {
  const api = getApi()
  if (!api) {
    logger.catch('GitBackend', `IPC API 未就绪，无法调用 ${channel}`)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

export const GitBackend = {
  // ===== 仓库基础能力 =====
  /** 检查当前环境是否可用 Git。 */
  checkAvailable: () => _call('git:checkAvailable'),
  /** 初始化知识库对应的 Git 仓库。 */
  init: (kbPath) => _call('git:init', kbPath),
  /** 读取单个知识库的 Git 状态。 */
  status: (kbPath) => _call('git:status', kbPath),
  /** 批量读取多个知识库的 Git 状态。 */
  statusBatch: (kbPaths) => _call('git:statusBatch', kbPaths),
  /** 判断仓库是否存在未提交改动。 */
  isDirty: (kbPath) => _call('git:isDirty', kbPath),
  /** 提交当前仓库改动。 */
  commit: (kbPath, msg) => _call('git:commit', kbPath, msg),
  /** 获取工作区或提交区间的 diff 文本。 */
  diff: (kbPath, opts) => _call('git:diff', kbPath, opts),
  /** 获取 diff 涉及的文件列表与统计。 */
  diffFiles: (kbPath, opts) => _call('git:diffFiles', kbPath, opts),
  /** 获取提交历史。 */
  log: (kbPath, opts) => _call('git:log', kbPath, opts),
  /** 获取指定提交涉及的文件列表。 */
  commitDiffFiles: (kbPath, hash) => _call('git:commitDiffFiles', kbPath, hash),
  /** 获取指定提交中某个文件的 diff。 */
  commitFileDiff: (kbPath, hash, fp) => _call('git:commitFileDiff', kbPath, hash, fp),

  // ===== 远程仓库同步 =====
  /** 获取远程仓库地址。 */
  remoteGet: (kbPath) => _call('git:remote:get', kbPath),
  /** 设置远程仓库地址。 */
  remoteSet: (kbPath, url) => _call('git:remote:set', kbPath, url),
  /** 拉取远程更新但不直接暴露细节。 */
  fetch: (kbPath) => _call('git:fetch', kbPath),
  /** 推送本地提交到远程。 */
  push: (kbPath) => _call('git:push', kbPath),
  /** 从远程拉取并合并更新。 */
  pull: (kbPath) => _call('git:pull', kbPath),

  // ===== 冲突处理 =====
  /** 获取当前冲突文件列表。 */
  conflictList: (kbPath) => _call('git:conflict:list', kbPath),
  /** 获取冲突文件内容详情。 */
  conflictShow: (kbPath, fp) => _call('git:conflict:show', kbPath, fp),
  /** 提交冲突解决结果。 */
  conflictResolve: (kbPath, fp, c) => _call('git:conflict:resolve', kbPath, fp, c),
  /** 完成冲突合并流程。 */
  conflictComplete: (kbPath) => _call('git:conflict:complete', kbPath),

  // ===== 认证能力 =====
  /** 保存远程仓库访问 Token。 */
  authSetToken: (kbPath, token) => _call('git:auth:setToken', kbPath, token),
  /** 获取应用维护的 SSH 公钥。 */
  authGetSSHKey: () => _call('git:auth:getSSHKey'),
  /** 设置 Git 认证方式。 */
  authSetType: (kbPath, type) => _call('git:auth:setAuthType', kbPath, type),
  /** 获取 Git 认证方式。 */
  authGetType: (kbPath) => _call('git:auth:getAuthType', kbPath),
}

/**
 * Git 状态内存缓存（模块级单例）
 */
const _cache = {}
const _dirty = {}
const _listeners = []
const CACHE_TTL = 30000
const MAX_CACHE_SIZE = 50
const CLEANUP_INTERVAL = 60000 // 60s 定期清理过期条目

export const GitCache = {
  /**
   * 将指定知识库标记为存在未提交改动，并通知订阅者。
   *
   * @param {string} kbPath 知识库路径
   * @returns {void}
   */
  markDirty(kbPath) {
    if (!kbPath) return
    _dirty[kbPath] = true
    if (_cache[kbPath]) {
      _cache[kbPath].status.state = 'dirty'
      _cache[kbPath].status.hasUncommitted = true
    }
    _notify(kbPath)
  },
  /**
   * 将指定知识库标记为干净状态，并通知订阅者。
   *
   * @param {string} kbPath 知识库路径
   * @returns {void}
   */
  markClean(kbPath) {
    _dirty[kbPath] = false
    _notify(kbPath)
  },

  /**
   * 写入知识库状态缓存，并在超过容量时清理最旧条目。
   *
   * @param {string} kbPath 知识库路径
   * @param {object} status Git 状态对象
   * @returns {void}
   */
  setStatus(kbPath, status) {
    if (!kbPath) return
    _cache[kbPath] = { status, timestamp: Date.now() }
    if (status.hasUncommitted || status.state === 'dirty') _dirty[kbPath] = true
    // LRU eviction: trim to MAX_CACHE_SIZE when over limit
    const keys = Object.keys(_cache)
    if (keys.length > MAX_CACHE_SIZE) {
      const sorted = keys.sort((a, b) => _cache[a].timestamp - _cache[b].timestamp)
      const toRemove = sorted.slice(0, keys.length - MAX_CACHE_SIZE + 1)
      toRemove.forEach(k => { delete _cache[k]; delete _dirty[k] })
    }
    _notify(kbPath)
  },

  /**
   * 读取指定知识库的缓存状态；缓存过期时返回 `null`。
   *
   * @param {string} kbPath 知识库路径
   * @returns {object|null} 缓存中的 Git 状态
   */
  getStatus(kbPath) {
    const cached = _cache[kbPath]
    return cached && Date.now() - cached.timestamp < CACHE_TTL ? cached.status : null
  },

  /**
   * 使指定知识库的缓存失效。
   *
   * @param {string} kbPath 知识库路径
   * @returns {void}
   */
  invalidate(kbPath) {
    delete _cache[kbPath]
    delete _dirty[kbPath]
  },

  /**
   * 判断指定知识库当前是否被标记为 dirty。
   *
   * @param {string} kbPath 知识库路径
   * @returns {boolean} 是否存在未提交改动
   */
  isDirty(kbPath) {
    return !!_dirty[kbPath]
  },

  /**
   * 订阅 Git 状态变更，返回取消订阅函数。
   *
   * @param {(kbPath: string, status: object|null) => void} fn 监听回调
   * @returns {() => void} 取消订阅函数
   */
  onStatusChange(fn) {
    _listeners.push(fn)
    return () => {
      _listeners = _listeners.filter(cb => cb !== fn)
    }
  },
}

/**
 * 向所有订阅者广播指定知识库的 Git 状态变更。
 *
 * @param {string} kbPath 知识库路径
 * @returns {void}
 */
function _notify(kbPath) {
  const status = _cache[kbPath]?.status || null
  _listeners.forEach(fn => { try { fn(kbPath, status) } catch (e) { logger.warn('GitBackend', '监听器通知失败:', e) } })
}

let _cleanupTimer = null

/**
 * 清理已过期的 Git 状态缓存条目。
 *
 * @returns {void}
 */
function _cleanupExpired() {
  const now = Date.now()
  let cleaned = 0
  for (const kbPath of Object.keys(_cache)) {
    const entry = _cache[kbPath]
    if (entry && now - entry.timestamp >= CACHE_TTL) {
      delete _cache[kbPath]
      delete _dirty[kbPath]
      cleaned++
    }
  }
  if (cleaned > 0) {
    logger.debug('GitBackend', `_cleanupExpired 清理了 ${cleaned} 条过期缓存`)
  }
}

/**
 * 启动 Git 状态缓存的定期过期清理任务。
 *
 * @returns {void}
 */
export function startGitCacheCleanup() {
  if (_cleanupTimer) return
  _cleanupTimer = setInterval(_cleanupExpired, CLEANUP_INTERVAL)
  logger.debug('GitBackend', 'GitCache 过期清理定时器已启动')
}

/**
 * 停止 Git 状态缓存的定期过期清理任务。
 *
 * @returns {void}
 */
export function stopGitCacheCleanup() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer)
    _cleanupTimer = null
    logger.debug('GitBackend', 'GitCache 过期清理定时器已停止')
  }
}
