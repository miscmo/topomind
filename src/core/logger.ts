/**
 * 统一日志服务
 * 替换散落在代码库各处的 console.warn / console.error
 * 提供模块化、级别化、带上下文的日志输出
 *
 * 双写模式：console（始终）+ 文件（通过 IPC 到主进程 LogService）
 */
import { logWrite } from './log-backend'

const _enabled = true
const _levelMap: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let _currentLevel: 'debug' | 'info' | 'warn' | 'error' = 'warn'

function _format(module: string, level: string, ...args: unknown[]) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const prefix = `[${ts}][${module}][${level.toUpperCase()}]`
  return [prefix, ...args]
}

function _shouldLog(level: string) {
  return _enabled && (_levelMap[level] ?? 0) >= (_levelMap[_currentLevel] ?? 2)
}

function _toServiceLevel(level: string): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  const map: Record<string, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'> = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }
  return map[level] ?? 'INFO'
}

function _extractMessage(module: string, level: string, ...args: unknown[]) {
  const parts = args.map((a) => {
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
  setLevel(level: 'debug' | 'info' | 'warn' | 'error') {
    if (_levelMap[level] !== undefined) _currentLevel = level
  },

  getLevel() {
    return _currentLevel
  },

  debug(module: string, ...args: unknown[]) {
    if (_shouldLog('debug')) {
      console.debug(..._format(module, 'debug'), ...args)
      logWrite({
        level: _toServiceLevel('debug'),
        module,
        message: _extractMessage(module, 'debug', ...args),
      }).catch(() => {})
    }
  },

  info(module: string, ...args: unknown[]) {
    if (_shouldLog('info')) {
      console.info(..._format(module, 'info'), ...args)
      logWrite({
        level: _toServiceLevel('info'),
        module,
        message: _extractMessage(module, 'info', ...args),
      }).catch(() => {})
    }
  },

  warn(module: string, ...args: unknown[]) {
    if (_shouldLog('warn')) {
      console.warn(..._format(module, 'warn'), ...args)
      logWrite({
        level: _toServiceLevel('warn'),
        module,
        message: _extractMessage(module, 'warn', ...args),
      }).catch(() => {})
    }
  },

  error(module: string, ...args: unknown[]) {
    if (_shouldLog('error')) {
      console.error(..._format(module, 'error'), ...args)
      logWrite({
        level: _toServiceLevel('error'),
        module,
        message: _extractMessage(module, 'error', ...args),
      }).catch(() => {})
    }
  },

  catch(module: string, context: string, err?: unknown) {
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
