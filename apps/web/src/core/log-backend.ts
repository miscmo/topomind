/**
 * 浏览器端日志后端。
 * 在纯 Web 版本中保留一份内存缓冲区，供监控页实时查看。
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
const LOG_BUFFER_LIMIT = 5000
const logBuffer: LogEntry[] = []
const listeners = new Set<(entry: LogEntry) => void>()

function nowIso() {
  return new Date().toISOString()
}

function nextLogId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeLogEntry(entry: Partial<LogEntry>): LogEntry {
  return {
    id: entry.id || nextLogId(),
    timestamp: entry.timestamp || nowIso(),
    level: entry.level || 'INFO',
    module: entry.module || 'App',
    file: entry.file,
    line: entry.line,
    func: entry.func,
    action: entry.action,
    message: entry.message,
    params: entry.params ?? null,
    traceId: entry.traceId ?? null,
    spanId: entry.spanId ?? null,
    parentId: entry.parentId ?? null,
    meta: entry.meta ?? null,
  }
}

function appendEntry(entry: LogEntry) {
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_LIMIT) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_LIMIT)
  }
  for (const listener of listeners) {
    try {
      listener(entry)
    } catch {
      // ignore listener errors to keep logging path stable
    }
  }
}

function matchesQuery(entry: LogEntry, opts: LogQueryOptions) {
  const keyword = opts.keyword?.trim().toLowerCase()
  if (keyword) {
    const haystack = [
      entry.message,
      entry.action,
      entry.module,
      entry.file,
      entry.func,
      JSON.stringify(entry.params ?? {}),
      JSON.stringify(entry.meta ?? {}),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(keyword)) {
      return false
    }
  }
  if (opts.dateStr && !String(entry.timestamp || '').startsWith(opts.dateStr)) {
    return false
  }
  if (opts.levels?.length) {
    const level = String(entry.level || '').toUpperCase()
    if (!opts.levels.map((item) => item.toUpperCase()).includes(level)) {
      return false
    }
  }
  if (opts.actions?.length) {
    const action = String(entry.action || '')
    if (!opts.actions.includes(action)) {
      return false
    }
  }
  const timestamp = Date.parse(String(entry.timestamp || ''))
  if (opts.startTime && Number.isFinite(timestamp) && timestamp < Date.parse(opts.startTime)) {
    return false
  }
  if (opts.endTime && Number.isFinite(timestamp) && timestamp > Date.parse(opts.endTime)) {
    return false
  }
  return true
}

export async function logWrite(entry: Partial<LogEntry>): Promise<boolean> {
  try {
    const normalized = normalizeLogEntry(entry)
    appendEntry(normalized)
    return true
  } catch {
    return false
  }
}

export async function logGetBuffer(): Promise<LogEntry[]> {
  return [...logBuffer]
}

export async function logQuery(opts: LogQueryOptions = {}): Promise<LogEntry[]> {
  return logBuffer.filter((entry) => matchesQuery(entry, opts))
}


export async function logClear(): Promise<boolean> {
  logBuffer.splice(0, logBuffer.length)
  return true
}

export async function logGetAvailableDates(): Promise<string[]> {
  return Array.from(
    new Set(
      logBuffer
        .map((entry) => String(entry.timestamp || '').slice(0, 10))
        .filter(Boolean),
    ),
  ).sort()
}

export function logSubscribe(callback: (entry: LogEntry) => void): void {
  listeners.add(callback)
}

export function logUnsubscribe(callback: (entry: LogEntry) => void): void {
  listeners.delete(callback)
}

// TODO：这里的module可以做出枚举，还没想好这里按照什么分类
/**
 * 构造并写入一条关键动作日志
 * @example
 *   await logAction('节点:双击', 'useGraph', { nodeId: 'auto-123', cardRef: 'kb-1/auto-123' })
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
