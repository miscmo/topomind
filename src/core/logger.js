/**
 * 统一日志服务
 * 替换散落在代码库各处的 console.warn / console.error
 * 提供模块化、级别化、带上下文的日志输出
 */

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

export const logger = {
  /**
   * 设置日志级别（生产环境设为 'error'）
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  setLevel(level) {
    if (_levelMap[level] !== undefined) _currentLevel = level
  },

  debug(module, ...args) {
    if (_shouldLog('debug')) console.debug(..._format(module, 'debug'), ...args)
  },

  info(module, ...args) {
    if (_shouldLog('info')) console.info(..._format(module, 'info'), ...args)
  },

  warn(module, ...args) {
    if (_shouldLog('warn')) console.warn(..._format(module, 'warn'), ...args)
  },

  error(module, ...args) {
    if (_shouldLog('error')) console.error(..._format(module, 'error'), ...args)
  },

  /**
   * 捕获并记录异常，保留原始错误信息
   * @param {string} module
   * @param {string} context  操作描述
   * @param {unknown} err
   */
  catch(module, context, err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(..._format(module, 'warn', `${context}失败:`, message))
  },
}
