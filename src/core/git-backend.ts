/**
 * Git IPC 前端调用封装 - ES Module 版本
 */
import { logger } from './logger'
import type { ElectronAPI } from '../types/electron-api'

const getApi = (): ElectronAPI | null => {
  return (window as Window).electronAPI ?? null
}

const _call = (channel: string, ...args: unknown[]) => {
  const api = getApi()
  if (!api) {
    logger.catch('GitBackend', `IPC API 未就绪，无法调用 ${channel}`, undefined)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  if (typeof api.invoke !== 'function') {
    logger.catch('GitBackend', `IPC API.invoke 不可用，无法调用 ${channel}`, undefined)
    return Promise.reject(new Error(`IPC API.invoke 不可用: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

export interface GitBackend {
  checkAvailable: () => Promise<unknown>
  init: (kbPath: string) => Promise<unknown>
  status: (kbPath: string) => Promise<unknown>
  statusBatch: (kbPaths: string[]) => Promise<unknown>
  isDirty: (kbPath: string) => Promise<unknown>
  commit: (kbPath: string, msg: string) => Promise<unknown>
  diff: (kbPath: string, opts?: object) => Promise<unknown>
  diffFiles: (kbPath: string, opts?: object) => Promise<unknown>
  log: (kbPath: string, opts?: object) => Promise<unknown>
  commitDiffFiles: (kbPath: string, hash: string) => Promise<unknown>
  commitFileDiff: (kbPath: string, hash: string, fp: string) => Promise<unknown>
  remoteGet: (kbPath: string) => Promise<unknown>
  remoteSet: (kbPath: string, url: string) => Promise<unknown>
  fetch: (kbPath: string) => Promise<unknown>
  push: (kbPath: string) => Promise<unknown>
  pull: (kbPath: string) => Promise<unknown>
  conflictList: (kbPath: string) => Promise<unknown>
  conflictShow: (kbPath: string, fp: string) => Promise<unknown>
  conflictResolve: (kbPath: string, fp: string, content: string) => Promise<unknown>
  conflictComplete: (kbPath: string) => Promise<unknown>
  authSetToken: (kbPath: string, token: string) => Promise<unknown>
  authGetSSHKey: () => Promise<unknown>
  authSetType: (kbPath: string, type: string) => Promise<unknown>
  authGetType: (kbPath: string) => Promise<unknown>
}

export interface GitCacheStatus {
  state: string
  hasUncommitted: boolean
  [key: string]: unknown
}

export interface GitCache {
  markDirty: (kbPath: string) => void
  markClean: (kbPath: string) => void
  setStatus: (kbPath: string, status: GitCacheStatus) => void
  getStatus: (kbPath: string) => GitCacheStatus | null
  invalidate: (kbPath: string) => void
  isDirty: (kbPath: string) => boolean
  onStatusChange: (fn: (kbPath: string, status: GitCacheStatus | null) => void) => () => void
}

export const GitBackend: GitBackend = {
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

// In-memory status cache
const _cache: Record<string, { status: GitCacheStatus; timestamp: number }> = {}
const _dirty: Record<string, boolean> = {}
const _listeners: Array<(kbPath: string, status: GitCacheStatus | null) => void> = []
const CACHE_TTL = 30000
const MAX_CACHE_SIZE = 50
const CLEANUP_INTERVAL = 60000

export const GitCache: GitCache = {
  markDirty(kbPath) {
    if (!kbPath) return
    _dirty[kbPath] = true
    if (_cache[kbPath]) {
      _cache[kbPath] = {
        ..._cache[kbPath],
        status: {
          ..._cache[kbPath].status,
          state: 'dirty',
          hasUncommitted: true,
        },
      }
    }
    _notify(kbPath)
  },

  markClean(kbPath) {
    _dirty[kbPath] = false
    _notify(kbPath)
  },

  setStatus(kbPath, status) {
    if (!kbPath) return
    _cache[kbPath] = { status, timestamp: Date.now() }
    if (status.hasUncommitted || status.state === 'dirty') _dirty[kbPath] = true
    const keys = Object.keys(_cache)
    if (keys.length > MAX_CACHE_SIZE) {
      const sorted = keys.sort((a, b) => _cache[a].timestamp - _cache[b].timestamp)
      const toRemove = sorted.slice(0, keys.length - MAX_CACHE_SIZE + 1)
      toRemove.forEach((k) => { delete _cache[k]; delete _dirty[k] })
    }
    _notify(kbPath)
  },

  getStatus(kbPath) {
    const cached = _cache[kbPath]
    return cached && Date.now() - cached.timestamp < CACHE_TTL ? cached.status : null
  },

  invalidate(kbPath) {
    delete _cache[kbPath]
    delete _dirty[kbPath]
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

function _notify(kbPath: string) {
  const status = _cache[kbPath]?.status || null
  _listeners.forEach((fn) => {
    try { fn(kbPath, status) } catch (e) { logger.warn('GitBackend', '监听器通知失败:', e) }
  })
}

let _cleanupTimer: ReturnType<typeof setInterval> | null = null

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

export function startGitCacheCleanup() {
  if (_cleanupTimer) return
  _cleanupTimer = setInterval(_cleanupExpired, CLEANUP_INTERVAL)
  logger.debug('GitBackend', 'GitCache 过期清理定时器已启动')
}

export function stopGitCacheCleanup() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer)
    _cleanupTimer = null
    logger.debug('GitBackend', 'GitCache 过期清理定时器已停止')
  }
}
