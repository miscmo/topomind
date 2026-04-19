/**
 * 日志后端（渲染进程 → Electron 主进程 LogService 的 IPC 桥接）
 *
 * 职责：
 * 1. 封装 window.electronAPI.invoke 调用
 * 2. 提供类型化的日志操作接口
 * 3. 订阅实时日志广播（log:entry）
 *
 * 使用方式：
 *   import { logWrite, logQuery, logSubscribe } from './log-backend'
 *   logWrite({ level: 'INFO', module: 'MyModule', action: 'do-something', message: '发生了什么' })
 */

/**
 * @typedef {Object} LogEntry
 * @property {string} [id]
 * @property {string} [timestamp]
 * @property {string} [level]   'DEBUG'|'INFO'|'WARN'|'ERROR'
 * @property {string} [module]
 * @property {string} [file]
 * @property {number} [line]
 * @property {string} [func]
 * @property {string} [action]   关键动作标识，如 '节点:选中'、'房间:钻入'
 * @property {string} [message]
 * @property {object|null} [params]
 * @property {string|null} [traceId]
 * @property {string|null} [spanId]
 * @property {string|null} [parentId]
 * @property {object|null} [meta]
 */

/**
 * @typedef {Object} LogQueryOptions
 * @property {string}   [dateStr]     YYYY-MM-DD，不传则查今天
 * @property {string}  [keyword]
 * @property {string[]} [levels]
 * @property {string[]} [actions]
 * @property {string}   [startTime]  ISO timestamp
 * @property {string}   [endTime]    ISO timestamp
 */

// ============================================================
// IPC 封装（直接使用 window.electronAPI，与 fs-backend 共享预加载通道）
// ============================================================

const _api = () => window.electronAPI

const _call = (channel, ...args) => {
  const api = _api()
  if (!api) return Promise.reject(new Error('IPC API 未就绪'))
  return api.invoke(channel, ...args)
}

const _warn = (...args) => {
  // Use console directly to avoid circular dependency with logger -> log-backend
  console.warn('[log-backend]', ...args)
}

// ============================================================
// 日志读写
// ============================================================

/**
 * 写入一条日志到文件
 * @param {Partial<LogEntry>} entry
 * @returns {Promise<boolean>}
 */
export async function logWrite(entry) {
  try {
    return await _call('log:write', entry)
  } catch (e) {
    _warn('log:write failed:', e.message)
    return false
  }
}

/**
 * 获取内存缓冲区（最新 2000 条）
 * @returns {Promise<LogEntry[]>}
 */
export async function logGetBuffer() {
  try {
    return await _call('log:getBuffer')
  } catch (e) {
    _warn('log:getBuffer failed:', e.message)
    return []
  }
}

/**
 * 查询日志文件
 * @param {LogQueryOptions} [opts]
 * @returns {Promise<LogEntry[]>}
 */
export async function logQuery(opts = {}) {
  try {
    return await _call('log:query', opts)
  } catch (e) {
    _warn('log:query failed:', e.message)
    return []
  }
}

/**
 * 设置日志等级
 * @param {string|number} level
 * @returns {Promise<boolean>}
 */
export async function logSetLevel(level) {
  try {
    return await _call('log:setLevel', level)
  } catch (e) {
    _warn('log:setLevel failed:', e.message)
    return false
  }
}

/**
 * 清除内存缓冲区
 * @returns {Promise<boolean>}
 */
export async function logClear() {
  try {
    return await _call('log:clear')
  } catch (e) {
    _warn('log:clear failed:', e.message)
    return false
  }
}

/**
 * 获取可用日志日期列表
 * @returns {Promise<string[]>} ['YYYY-MM-DD', ...]
 */
export async function logGetAvailableDates() {
  try {
    return await _call('log:getAvailableDates')
  } catch (e) {
    _warn('log:getAvailableDates failed:', e.message)
    return []
  }
}

/**
 * 获取日志目录路径
 * @returns {Promise<string|null>}
 */
export async function logGetLogDir() {
  try {
    return await _call('log:getLogDir')
  } catch (e) {
    _warn('log:getLogDir failed:', e.message)
    return null
  }
}

// ============================================================
// 实时广播订阅
// ============================================================

/** @type {Set<(entry: LogEntry) => void>} */
const _listeners = new Set()

/** 是否已订阅 log:entry */
let _subscribed = false

/**
 * 订阅实时日志流（所有监听的窗口都会收到）
 * @param {(entry: LogEntry) => void} callback
 */
export function logSubscribe(callback) {
  _listeners.add(callback)

  if (!_subscribed) {
    _subscribed = true
    const api = _api()
    if (api) {
      api.on('log:entry', (entry) => {
        for (const cb of _listeners) {
          try { cb(entry) } catch (e) { /* ignore */ }
        }
      })
    }
  }
}

/**
 * 取消订阅
 * @param {(entry: LogEntry) => void} callback
 */
export function logUnsubscribe(callback) {
  _listeners.delete(callback)
  if (_listeners.size === 0) {
    _subscribed = false
    const api = _api()
    if (api) api.off('log:entry')
  }
}

// ============================================================
// 便捷构造器
// ============================================================

/**
 * 构造并写入一条关键动作日志
 *
 * @param {string} action   - 动作标识，如 '节点:选中'
 * @param {string} [module] - 来源模块，如 'useGraph'
 * @param {object} [params] - 关键参数
 * @returns {Promise<boolean>}
 *
 * @example
 *   await logAction('节点:双击', 'useGraph', { nodeId: 'auto-123', path: 'AI/机器学习' })
 */
export async function logAction(action, module = 'App', params = {}) {
  return logWrite({
    level: 'INFO',
    module,
    action,
    params,
  })
}
