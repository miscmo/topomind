/**
 * Git IPC 前端调用封装 - ES Module 版本
 */
const api = window.electronAPI

export const GitBackend = {
  checkAvailable: () => api.invoke('git:checkAvailable'),
  init: (kbPath) => api.invoke('git:init', kbPath),
  status: (kbPath) => api.invoke('git:status', kbPath),
  statusBatch: (kbPaths) => api.invoke('git:statusBatch', kbPaths),
  isDirty: (kbPath) => api.invoke('git:isDirty', kbPath),
  commit: (kbPath, msg) => api.invoke('git:commit', kbPath, msg),
  diff: (kbPath, opts) => api.invoke('git:diff', kbPath, opts),
  diffFiles: (kbPath, opts) => api.invoke('git:diffFiles', kbPath, opts),
  log: (kbPath, opts) => api.invoke('git:log', kbPath, opts),
  commitDiffFiles: (kbPath, hash) => api.invoke('git:commitDiffFiles', kbPath, hash),
  commitFileDiff: (kbPath, hash, fp) => api.invoke('git:commitFileDiff', kbPath, hash, fp),
  remoteGet: (kbPath) => api.invoke('git:remote:get', kbPath),
  remoteSet: (kbPath, url) => api.invoke('git:remote:set', kbPath, url),
  fetch: (kbPath) => api.invoke('git:fetch', kbPath),
  push: (kbPath) => api.invoke('git:push', kbPath),
  pull: (kbPath) => api.invoke('git:pull', kbPath),
  conflictList: (kbPath) => api.invoke('git:conflict:list', kbPath),
  conflictShow: (kbPath, fp) => api.invoke('git:conflict:show', kbPath, fp),
  conflictResolve: (kbPath, fp, c) => api.invoke('git:conflict:resolve', kbPath, fp, c),
  conflictComplete: (kbPath) => api.invoke('git:conflict:complete', kbPath),
  authSetToken: (kbPath, token) => api.invoke('git:auth:setToken', kbPath, token),
  authGetSSHKey: () => api.invoke('git:auth:getSSHKey'),
  authSetType: (kbPath, type) => api.invoke('git:auth:setAuthType', kbPath, type),
  authGetType: (kbPath) => api.invoke('git:auth:getAuthType', kbPath),
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
  _listeners.forEach(fn => { try { fn(kbPath, status) } catch (e) {} })
}
