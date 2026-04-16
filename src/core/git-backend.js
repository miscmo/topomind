import { logger } from './logger.js'

/**
 * Git IPC 前端调用封装 - ES Module 版本
 */
const getApi = () => window.electronAPI

/**
 * 空安全的 IPC 调用封装
 * 与 fs-backend.js 保持一致，防止 electronAPI 未就绪时抛出 NPE
 */
const _call = (channel, ...args) => {
  const api = getApi()
  if (!api) {
    logger.warn('GitBackend', `IPC API 未就绪，无法调用 ${channel}`)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

export const GitBackend = {
  checkAvailable: () => _call('git:checkAvailable'),
  init: (kbPath) => _call('git:init', kbPath),
  status: (kbPath) => _call('git:status', kbPath),
  statusBatch: (kbPaths) => _call('git:statusBatch', kbPaths),
  isDirty: (kbPath) => _call('git:isDirty', kbPath),
  commit: (kbPath, msg) => _call('git:commit', kbPath, msg),
  diff: (kbPath, opts) => _call('git:diff', kbPath, opts),
  diffFiles: (kbPath, opts) => _call('git:diffFiles', kbPath, opts),
  log: (kbPath, opts) => _call('git:log', kbPath, opts),
  commitDiffFiles: (kbPath, hash) => _call('git:commitDiffFiles', kbPath, hash),
  commitFileDiff: (kbPath, hash, fp) => _call('git:commitFileDiff', kbPath, hash, fp),
  remoteGet: (kbPath) => _call('git:remote:get', kbPath),
  remoteSet: (kbPath, url) => _call('git:remote:set', kbPath, url),
  fetch: (kbPath) => _call('git:fetch', kbPath),
  push: (kbPath) => _call('git:push', kbPath),
  pull: (kbPath) => _call('git:pull', kbPath),
  conflictList: (kbPath) => _call('git:conflict:list', kbPath),
  conflictShow: (kbPath, fp) => _call('git:conflict:show', kbPath, fp),
  conflictResolve: (kbPath, fp, c) => _call('git:conflict:resolve', kbPath, fp, c),
  conflictComplete: (kbPath) => _call('git:conflict:complete', kbPath),
  authSetToken: (kbPath, token) => _call('git:auth:setToken', kbPath, token),
  authGetSSHKey: () => _call('git:auth:getSSHKey'),
  authSetType: (kbPath, type) => _call('git:auth:setAuthType', kbPath, type),
  authGetType: (kbPath) => _call('git:auth:getAuthType', kbPath),
}

/**
 * Git 状态内存缓存（模块级单例）
 */
const _cache = {}
const _dirty = {}
const _listeners = []
const CACHE_TTL = 30000

export const GitCache = {
  markDirty(kbPath) {
    if (!kbPath) return
    _dirty[kbPath] = true
    if (_cache[kbPath]) {
      _cache[kbPath].status.state = 'dirty'
      _cache[kbPath].status.hasUncommitted = true
    }
    _notify(kbPath)
  },
  markClean(kbPath) {
    _dirty[kbPath] = false
    _notify(kbPath)
  },
  setStatus(kbPath, status) {
    _cache[kbPath] = { status, timestamp: Date.now() }
    if (status.hasUncommitted || status.state === 'dirty') _dirty[kbPath] = true
    _notify(kbPath)
  },
  getStatus(kbPath) {
    const cached = _cache[kbPath]
    return cached && Date.now() - cached.timestamp < CACHE_TTL ? cached.status : null
  },
  invalidate(kbPath) {
    delete _cache[kbPath]
  },
  isDirty(kbPath) {
    return !!_dirty[kbPath]
  },
  onStatusChange(fn) {
    _listeners.push(fn)
    return () => {
      const idx = _listeners.indexOf(fn)
      if (idx !== -1) _listeners.splice(idx, 1)
    }
  },
}

function _notify(kbPath) {
  const status = _cache[kbPath]?.status || null
  _listeners.forEach(fn => { try { fn(kbPath, status) } catch (e) { logger.warn('GitBackend', '监听器通知失败:', e) } })
}
