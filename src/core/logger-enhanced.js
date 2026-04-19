/**
 * 增强型前端日志模块
 *
 * 对外接口与 src/core/logger.js 保持兼容，
 * 同时增加：
 * - 结构化 JSON 格式
 * - IPC 上报到后端 LogService
 * - 关键动作(action)标识
 * - 链路追踪(traceId)
 * - 本地内存缓冲区（实时消费）
 */

import { logger as _baseLogger } from './logger.js'

// ============================================================
// 1. 常量
// ============================================================

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']

const LEVEL_MAP = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// 关键动作枚举
export const Action = {
  APP_START: 'app:start',
  APP_READY: 'app:ready',
  APP_MOUNT: 'app:mount',
  WINDOW_CREATE: 'window:create',

  KB_OPEN: 'kb:open',
  KB_SWITCH: 'kb:switch',
  KB_CREATE: 'kb:create',
  KB_DELETE: 'kb:delete',

  ROOM_ENTER: 'room:enter',
  ROOM_DRILL_INTO: 'room:drillInto',
  ROOM_GO_BACK: 'room:goBack',
  ROOM_GO_ROOT: 'room:goRoot',
  ROOM_JUMP_TO: 'room:jumpTo',

  NODE_SELECT: 'node:select',
  NODE_UNSELECT: 'node:unselect',
  NODE_ADD: 'node:add',
  NODE_DELETE: 'node:delete',
  NODE_RENAME: 'node:rename',
  NODE_DBLTAP: 'node:dbltap',

  EDGE_ADD: 'edge:add',
  EDGE_DELETE: 'edge:delete',

  LAYOUT_SAVE: 'layout:save',
  LAYOUT_AUTO: 'layout:auto',

  VIEW_ZOOM: 'view:zoom',
  VIEW_FIT: 'view:fit',
  VIEW_RESET_ZOOM: 'view:resetZoom',

  SEARCH_APPLY: 'search:apply',

  PANEL_TOGGLE: 'panel:toggle',
  PANEL_RESIZE: 'panel:resize',

  TAB_OPEN: 'tab:open',
  TAB_SWITCH: 'tab:switch',
  TAB_CLOSE: 'tab:close',

  GIT_COMMIT: 'git:commit',
  GIT_SYNC: 'git:sync',

  MARKDOWN_SAVE: 'markdown:save',
  MARKDOWN_LOAD: 'markdown:load',

  IMAGE_SAVE: 'image:save',

  STORAGE_ERROR: 'storage:error',

  PERF_LOAD_ROOM: 'perf:loadRoom',
  PERF_LAYOUT: 'perf:layout',
  PERF_STARTUP: 'perf:startup',
}

// ============================================================
// 2. 链路追踪
// ============================================================

/** 当前 traceId（一次应用会话内共享） */
let _traceId = _genTraceId()

function _genTraceId() {
  return Date.now().toString(36).toUpperCase()
}

/** 获取当前 traceId */
export function getTraceId() {
  return _traceId
}

/** 重置 traceId */
export function resetTraceId() {
  _traceId = _genTraceId()
}

// ============================================================
// 3. 调用位置信息提取
// ============================================================

/**
 * 获取调用位置的 (file, line, func)
 */
function _getCallerLocation(depth = 3) {
  try {
    const err = new Error()
    const stack = err.stack?.split('\n') || []
    // stack[0] = Error
    // stack[1] = _getCallerLocation
    // stack[2] = _write
    // stack[3] = info/warn/error
    // stack[4] = 调用方
    const frame = stack[depth]
    if (!frame) return { file: '', line: 0, func: '' }

    // Chrome/V8 格式: "    at functionName (file:line:col)"
    // Firefox 格式: "functionName@file:line:col"
    let file = '', line = 0, func = ''

    const chromeMatch = frame.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):\d+\)?/)
    const ffMatch = frame.match(/@(.+?):(\d+)/)

    if (chromeMatch) {
      func = chromeMatch[1] || ''
      file = chromeMatch[2]?.split('/').pop() || ''
      line = parseInt(chromeMatch[3], 10) || 0
    } else if (ffMatch) {
      file = ffMatch[1]?.split('/').pop() || ''
      line = parseInt(ffMatch[2], 10) || 0
    }

    return { file, line, func }
  } catch (e) {
    return { file: '', line: 0, func: '' }
  }
}

// ============================================================
// 4. IPC 传输
// ============================================================

const _getApi = () => window.electronAPI

const _ipcWrite = (entry) => {
  const api = _getApi()
  if (!api) return
  try {
    api.invoke('log:write', entry)
  } catch (e) {
    // 静默失败，避免日志系统自身的错误循环
  }
}

// ============================================================
// 5. 本地缓冲区（用于 LogMonitorView 实时展示）
// ============================================================

const MAX_LOCAL_BUFFER = 500

const _localBuffer = []
let _localListeners = []

export function subscribeLocalLogs(callback) {
  _localListeners.push(callback)
  return () => {
    _localListeners = _localListeners.filter(l => l !== callback)
  }
}

export function getLocalBuffer() {
  return [..._localBuffer]
}

function _emitToLocal(entry) {
  _localBuffer.push(entry)
  if (_localBuffer.length > MAX_LOCAL_BUFFER) {
    _localBuffer.shift()
  }
  for (const cb of _localListeners) {
    try { cb(entry) } catch (e) { /* ignore */ }
  }
}

// ============================================================
// 6. 日志写入核心
// ============================================================

let _currentLevel = 'info'
let _spanCounter = 0

function _write(level, module, action, message, params, meta) {
  if (LEVEL_MAP[level] < LEVEL_MAP[_currentLevel]) return

  const loc = _getCallerLocation(4)
  const spanId = `${_traceId}${String(_spanCounter++).padStart(4, '0')}`

  const entry = {
    level: level.toUpperCase(),
    module,
    action: action || '',
    message,
    params: params || null,
    traceId: _traceId,
    spanId,
    meta: meta || null,
    // 位置信息从调用栈提取
    file: loc.file,
    line: loc.line,
    func: loc.func,
  }

  // 1. console 输出（开发调试保留）
  _baseLogger[level](module, message, params || '')

  // 2. IPC 上报到后端
  _ipcWrite(entry)

  // 3. 本地实时消费
  _emitToLocal(entry)

  return entry
}

// ============================================================
// 7. 导出接口（兼容 + 扩展）
// ============================================================

export const loggerEnhanced = {
  /**
   * 设置日志等级
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  setLevel(level) {
    _currentLevel = level
    _baseLogger.setLevel(level)
  },

  /**
   * 获取当前日志等级
   */
  getLevel() {
    return _currentLevel
  },

  /**
   * DEBUG 级别日志
   */
  debug(module, message, params) {
    return _write('debug', module, '', message, params)
  },

  /**
   * INFO 级别日志（带 action）
   */
  info(module, action, message, params, meta) {
    return _write('info', module, action, message, params, meta)
  },

  /**
   * WARN 级别日志（带 action）
   */
  warn(module, action, message, params, meta) {
    return _write('warn', module, action, message, params, meta)
  },

  /**
   * ERROR 级别日志（带 action）
   */
  error(module, action, message, params, meta) {
    return _write('error', module, action, message, params, meta)
  },

  /**
   * 兼容原有 catch 接口
   */
  catch(module, context, err) {
    _baseLogger.catch(module, context, err)
    // 同时以 structured 方式记录
    const message = typeof context === 'string' ? context : (context?.message || String(context))
    const errObj = err instanceof Error ? {
      name: err.name,
      message: err.message,
      stack: err.stack,
    } : String(err)
    return _write('error', module, 'error', message, { context, error: errObj })
  },

  /**
   * 创建子 span（用于链路追踪）
   * 返回一个 logger 实例，其 traceId/spanId 已设置
   */
  startSpan(module, action, message, params) {
    const parentSpanId = `${_traceId}${String(_spanCounter - 1).padStart(4, '0')}`
    const spanId = `${_traceId}${String(_spanCounter++).padStart(4, '0')}`

    const loc = _getCallerLocation(4)
    const entry = {
      level: 'INFO',
      module,
      action: action || '',
      message,
      params: params || null,
      traceId: _traceId,
      spanId,
      parentId: parentSpanId,
      meta: null,
      file: loc.file,
      line: loc.line,
      func: loc.func,
    }

    _baseLogger.info(module, message, params || '')
    _ipcWrite(entry)
    _emitToLocal(entry)

    return {
      end(level = 'INFO', meta) {
        // span 结束时的结束标记（轻量处理）
        return entry
      },
      entry,
    }
  },

  /**
   * 带性能指标的日志
   */
  perf(module, action, message, duration, params) {
    return _write('info', module, action, message, params, { duration })
  },

  /**
   * 获取模块列表
   */
  getModules() {
    const modules = new Set()
    for (const entry of _localBuffer) {
      if (entry.module) modules.add(entry.module)
    }
    return [...modules]
  },

  /**
   * 获取 action 列表
   */
  getActions() {
    const actions = new Set()
    for (const entry of _localBuffer) {
      if (entry.action) actions.add(entry.action)
    }
    return [...actions]
  },
}

// 保留原有 logger 接口的别名
export const logger = loggerEnhanced

export default loggerEnhanced
