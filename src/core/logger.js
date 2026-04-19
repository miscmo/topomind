/**
 * 统一日志服务
 * 替换散落在代码库各处的 console.warn / console.error
 * 提供模块化、级别化、带上下文的日志输出
 *
 * 双写模式：console（始终）+ 文件（通过 IPC 到主进程 LogService）
 */
import { logWrite } from './log-backend.js'

const _enabled = true
const _levelMap = { debug: 0, info: 1, warn: 2, error: 3 }

let _currentLevel = 'warn'

function _format(module, level, ...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const prefix = `[${ts}][${module}][${level.toUpperCase()}]`
  return [prefix, ...args]
}

function _shouldLog(level) {
  return _enabled && (_levelMap[level] ?? 0) >= (_levelMap[_currentLevel] ?? 2)
}

/**
 * 转换为 LogService 的 level 格式
 */
function _toServiceLevel(level) {
  const map = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }
  return map[level] ?? 'INFO'
}

/**
 * 提取消息文本（从 _format 输出中取出可读文本）
 */
function _extractMessage(module, level, ...args) {
  const parts = args.map(a => {
    if (a === undefined) return 'undefined'
    if (a === null) return 'null'
    if (typeof a === 'object') {
      try { return JSON.stringify(a) } catch { return String(a) }
    }
    return String(a)
  })
  return parts.join(' ')
}

export const logger = {
  /**
   * 设置日志级别（生产环境设为 'error'）
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  setLevel(level) {
    if (_levelMap[level] !== undefined) _currentLevel = level
  },

  /**
   * 获取当前日志级别
   */
  getLevel() {
    return _currentLevel
  },

  debug(module, ...args) {
    if (_shouldLog('debug')) {
      console.debug(..._format(module, 'debug'), ...args)
      logWrite({
        level: _toServiceLevel('debug'),
        module,
        message: _extractMessage(module, 'debug', ...args),
      }).catch(() => {}) // 不阻塞主流程
    }
  },

  info(module, ...args) {
    if (_shouldLog('info')) {
      console.info(..._format(module, 'info'), ...args)
      logWrite({
        level: _toServiceLevel('info'),
        module,
        message: _extractMessage(module, 'info', ...args),
      }).catch(() => {})
    }
  },

  warn(module, ...args) {
    if (_shouldLog('warn')) {
      console.warn(..._format(module, 'warn'), ...args)
      logWrite({
        level: _toServiceLevel('warn'),
        module,
        message: _extractMessage(module, 'warn', ...args),
      }).catch(() => {})
    }
  },

  error(module, ...args) {
    if (_shouldLog('error')) {
      console.error(..._format(module, 'error'), ...args)
      logWrite({
        level: _toServiceLevel('error'),
        module,
        message: _extractMessage(module, 'error', ...args),
      }).catch(() => {})
    }
  },

  /**
   * 捕获并记录异常，保留原始错误信息
   * @param {string} module
   * @param {string} context  操作描述
   * @param {unknown} err
   */
  catch(module, context, err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error(..._format(module, 'error', `${context}失败:`, message), ...(stack ? ['\n', stack] : []))
    logWrite({
      level: 'ERROR',
      module,
      message: `${context}失败: ${message}`,
      params: { context, stack },
    }).catch(() => {})
  },
}
