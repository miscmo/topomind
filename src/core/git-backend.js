/**
 * Git IPC 前端调用封装 - ES Module 版本
 */
const getApi = () => window.electronAPI

export const GitBackend = {
  checkAvailable: () => getApi().invoke('git:checkAvailable'),
  init: (kbPath) => getApi().invoke('git:init', kbPath),
  status: (kbPath) => getApi().invoke('git:status', kbPath),
  statusBatch: (kbPaths) => getApi().invoke('git:statusBatch', kbPaths),
  isDirty: (kbPath) => getApi().invoke('git:isDirty', kbPath),
  commit: (kbPath, msg) => getApi().invoke('git:commit', kbPath, msg),
  diff: (kbPath, opts) => getApi().invoke('git:diff', kbPath, opts),
  diffFiles: (kbPath, opts) => getApi().invoke('git:diffFiles', kbPath, opts),
  log: (kbPath, opts) => getApi().invoke('git:log', kbPath, opts),
  commitDiffFiles: (kbPath, hash) => getApi().invoke('git:commitDiffFiles', kbPath, hash),
  commitFileDiff: (kbPath, hash, fp) => getApi().invoke('git:commitFileDiff', kbPath, hash, fp),
  remoteGet: (kbPath) => getApi().invoke('git:remote:get', kbPath),
  remoteSet: (kbPath, url) => getApi().invoke('git:remote:set', kbPath, url),
  fetch: (kbPath) => getApi().invoke('git:fetch', kbPath),
  push: (kbPath) => getApi().invoke('git:push', kbPath),
  pull: (kbPath) => getApi().invoke('git:pull', kbPath),
  conflictList: (kbPath) => getApi().invoke('git:conflict:list', kbPath),
  conflictShow: (kbPath, fp) => getApi().invoke('git:conflict:show', kbPath, fp),
  conflictResolve: (kbPath, fp, c) => getApi().invoke('git:conflict:resolve', kbPath, fp, c),
  conflictComplete: (kbPath) => getApi().invoke('git:conflict:complete', kbPath),
  authSetToken: (kbPath, token) => getApi().invoke('git:auth:setToken', kbPath, token),
  authGetSSHKey: () => getApi().invoke('git:auth:getSSHKey'),
  authSetType: (kbPath, type) => getApi().invoke('git:auth:setAuthType', kbPath, type),
  authGetType: (kbPath) => getApi().invoke('git:auth:getAuthType', kbPath),
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
