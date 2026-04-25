/**
 * 日志后端（渲染进程 → Electron 主进程 LogService 的 IPC 桥接）
 */
import type { ElectronAPI } from '../types/electron-api'

interface LogEntry {
  id?: string
  timestamp?: string
  level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module?: string
  file?: string
  line?: number
  func?: string
  action?: string
  message?: string
  params?: Record<string, unknown> | null
  traceId?: string | null
  spanId?: string | null
  parentId?: string | null
  meta?: Record<string, unknown> | null
}

interface LogQueryOptions {
  dateStr?: string
  keyword?: string
  levels?: string[]
  actions?: string[]
  startTime?: string
  endTime?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _api = (): ElectronAPI | null => {
  return (window as Window).electronAPI ?? null
}

const _call = (channel: string, ...args: unknown[]) => {
  const api = _api()
  if (!api) return Promise.reject(new Error('IPC API 未就绪'))
  return api.invoke(channel, ...args)
}

/** 直接吞掉错误，避免控制台输出；日志由 file-service 异步落盘 */
const _warn = (..._args: unknown[]) => {
  return
}

export async function logWrite(entry: Partial<LogEntry>): Promise<boolean> {
  const api = _api()
  if (!api) return false
  try {
    return await (_call('log:write', entry) as Promise<boolean>)
  } catch (e) {
    return false
  }
}

export async function logGetBuffer(): Promise<LogEntry[]> {
  try {
    return await (_call('log:getBuffer') as Promise<LogEntry[]>)
  } catch {
    return []
  }
}

export async function logQuery(opts: LogQueryOptions = {}): Promise<LogEntry[]> {
  try {
    return await (_call('log:query', opts) as Promise<LogEntry[]>)
  } catch {
    return []
  }
}

export async function logSetLevel(level: string | number): Promise<boolean> {
  try {
    return await (_call('log:setLevel', level) as Promise<boolean>)
  } catch {
    return false
  }
}

export async function logClear(): Promise<boolean> {
  try {
    return await (_call('log:clear') as Promise<boolean>)
  } catch {
    return false
  }
}

export async function logGetAvailableDates(): Promise<string[]> {
  try {
    return await (_call('log:getAvailableDates') as Promise<string[]>)
  } catch {
    return []
  }
}

export async function logGetLogDir(): Promise<string | null> {
  try {
    return await (_call('log:getLogDir') as Promise<string | null>)
  } catch {
    return null
  }
}

const _listeners = new Set<(entry: LogEntry) => void>()
let _ipcHandler: ((entry: unknown) => void) | null = null
let _ipcRegistered = false

function _dispatchToListeners(entry: LogEntry) {
  for (const cb of _listeners) {
    try { cb(entry) } catch { /* ignore */ }
  }
}

export function logSubscribe(callback: (entry: LogEntry) => void): void {
  const wasEmpty = _listeners.size === 0
  _listeners.add(callback)

  // Register the IPC handler only once (first subscriber).
  // Use _ipcRegistered flag to avoid duplicate handler registration.
  if (!_ipcRegistered) {
    _ipcRegistered = true
    const api = _api()
    if (api) {
      _ipcHandler = (entry: unknown) => _dispatchToListeners(entry as LogEntry)
      api.on('log:entry', _ipcHandler)
    }
  }

  // Send log:subscribe only when transitioning from 0 → 1 subscribers.
  // Subsequent logSubscribe calls (listeners already populated) skip the IPC.
  if (wasEmpty) {
    const api = _api()
    if (api) {
      api.send('log:subscribe')
    }
  }
}

export function logUnsubscribe(callback: (entry: LogEntry) => void): void {
  _listeners.delete(callback)

  // Send log:unsubscribe only when transitioning from 1 → 0 subscribers.
  // Unregister the IPC handler after the last listener leaves.
  if (_listeners.size === 0 && _ipcRegistered) {
    _ipcRegistered = false
    const api = _api()
    if (api) {
      api.send('log:unsubscribe')
      if (_ipcHandler) {
        api.off('log:entry', _ipcHandler)
      }
      _ipcHandler = null
    }
  }
}

/**
 * 构造并写入一条关键动作日志
 * @example
 *   await logAction('节点:双击', 'useGraph', { nodeId: 'auto-123', path: 'AI/机器学习' })
 */
export async function logAction(
  action: string,
  module = 'App',
  params: Record<string, unknown> = {},
): Promise<boolean> {
  return logWrite({
    level: 'INFO',
    module,
    action,
    params,
  })
}
