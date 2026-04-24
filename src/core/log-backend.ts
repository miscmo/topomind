/**
 * 日志后端（渲染进程 → Electron 主进程 LogService 的 IPC 桥接）
 */
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
const _api = (): any => (window as any).electronAPI

const _call = (channel: string, ...args: unknown[]) => {
  const api = _api()
  if (!api) return Promise.reject(new Error('IPC API 未就绪'))
  return api.invoke(channel, ...args)
}

/** 直接写 console.warn 避免循环依赖 */
const _warn = (...args: unknown[]) => {
  console.warn('[log-backend]', ...args)
}

export async function logWrite(entry: Partial<LogEntry>): Promise<boolean> {
  try {
    return await _call('log:write', entry)
  } catch (e) {
    _warn('log:write failed:', (e as Error).message)
    return false
  }
}

export async function logGetBuffer(): Promise<LogEntry[]> {
  try {
    return await _call('log:getBuffer')
  } catch (e) {
    _warn('log:getBuffer failed:', (e as Error).message)
    return []
  }
}

export async function logQuery(opts: LogQueryOptions = {}): Promise<LogEntry[]> {
  try {
    return await _call('log:query', opts)
  } catch (e) {
    _warn('log:query failed:', (e as Error).message)
    return []
  }
}

export async function logSetLevel(level: string | number): Promise<boolean> {
  try {
    return await _call('log:setLevel', level)
  } catch (e) {
    _warn('log:setLevel failed:', (e as Error).message)
    return false
  }
}

export async function logClear(): Promise<boolean> {
  try {
    return await _call('log:clear')
  } catch (e) {
    _warn('log:clear failed:', (e as Error).message)
    return false
  }
}

export async function logGetAvailableDates(): Promise<string[]> {
  try {
    return await _call('log:getAvailableDates')
  } catch (e) {
    _warn('log:getAvailableDates failed:', (e as Error).message)
    return []
  }
}

export async function logGetLogDir(): Promise<string | null> {
  try {
    return await _call('log:getLogDir')
  } catch (e) {
    _warn('log:getLogDir failed:', (e as Error).message)
    return null
  }
}

const _listeners = new Set<(entry: LogEntry) => void>()
let _ipcHandler: ((entry: LogEntry) => void) | null = null
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
      _ipcHandler = _dispatchToListeners
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
