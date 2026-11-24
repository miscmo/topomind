/**
 * 日志桥接层（渲染进程 → Electron 主进程 LogService 的 IPC）。
 *
 * 职责边界：只做 IPC 收发、订阅管理与 logAction 薄封装；字段结构、等级、
 * action 注册表一律来自 @/shared/observability/logContract（唯一真源）。
 * 业务代码应使用 src/core/logger.ts 的统一入口，不要直接调用 logWrite。
 *
 * 所有来源最终都经过 buildLogEntry —— 等级归一化、module 归域、脱敏、
 * 长度与深度限制只在这里发生一次，主进程只做校验与补全。
 *
 * P2 T2.4 起业务调用点统一传规范 id；中文字符串仅由 LEGACY_ACTION_MAP
 * 兼容旧日志/插件 API。logAction 还负责单点补齐 v3 用户事件三件套
 * （target / result / trace），106 处调用点不需要逐个改字段。
 */
import {
  LOG_LEVELS,
  buildLogEntry,
  resolveAction,
  UNKNOWN_ACTION_ID,
  type LogEntry,
  type LogEntryInput,
  type LogLevel,
  type LogTarget,
  type LogFactKind,
  type LogQueryInput,
  type LogQueryResult,
  type LogWriteResult,
} from '../shared/observability/logContract.ts'
import type { ElectronAPI } from '../types/electron-api.ts'
import { stepCount, dumpSteps } from './traceBuffer.ts'

export type { LogEntry, LogQueryInput, LogQueryResult, LogWriteResult, LogLevel }
export type LogQueryOptions = LogQueryInput

const _api = (): ElectronAPI | null => {
  // 回归脚本会在 Node 里打包执行本模块，此时没有 window；不能直接解引用。
  if (typeof window === 'undefined') return null
  return (window as Window).electronAPI ?? null
}

const _call = (channel: string, ...args: unknown[]) => {
  const api = _api()
  if (!api) return Promise.reject(new Error('IPC API 未就绪'))
  return api.invoke(channel, ...args)
}

// ------------------------------------------------------------
// 未就绪窗口期的预缓冲：preload 注入之前产生的日志不丢弃。
// ------------------------------------------------------------
const MAX_PENDING = 200
const _pending: Array<Partial<LogEntry>> = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _flushAttempts = 0
let _warnedOnce = false
/** 预缓冲溢出时被丢弃的条数；只记数不写日志（避免自我放大），供诊断读取。 */
let _pendingDropped = 0

function _warnFailure(message: string, error: unknown) {
  if (_warnedOnce) return
  _warnedOnce = true
  // 日志通道自身故障时只能落到控制台；禁止在这里再次写日志（会自我放大）。
  // 本文件在 eslint no-console 白名单内（见 eslint.config.js）。
  console.error('[log-backend]', message, error)
}

/** 失败后按指数退避继续重调度；API 未就绪时也不会把启动期日志永久留在队列里。 */
function _scheduleFlush(retry = false) {
  if (_flushTimer || _pending.length === 0) return
  // Node 回归脚本没有 window / IPC，重调度会形成永动定时器让进程无法退出。
  // 浏览器里也设上限：API 长期不注入时保留队列、停止唤醒，由后续写入重新触发。
  if (typeof window === 'undefined') return
  if (retry && _flushAttempts >= 20) return
  const delay = retry ? Math.min(120 * 2 ** Math.min(_flushAttempts, 5), 4000) : 120
  if (retry) _flushAttempts += 1
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    void _flushPending()
  }, delay)
}

/** 逐条确认成功后再出队；任何一条失败都保留队列并安排重试，不丢日志。 */
async function _flushPending() {
  if (_pending.length === 0) {
    _flushAttempts = 0
    return
  }
  const api = _api()
  if (!api) {
    _scheduleFlush(true)
    return
  }
  while (_pending.length > 0) {
    const entry = _pending[0]
    try {
      await _call('log:write', entry)
      _pending.shift()
    } catch (error) {
      _warnFailure('flush pending log failed', error)
      _scheduleFlush(true)
      return
    }
  }
  _flushAttempts = 0
}

export function logGetPendingStats(): { queued: number; dropped: number } {
  return { queued: _pending.length, dropped: _pendingDropped }
}

/**
 * 写入一条日志。所有来源的唯一 IPC 出口：先经 buildLogEntry 规整字段，
 * 再交给主进程。返回是否已被主进程接受（等级过滤/校验失败返回 false）。
 */
export async function logWrite(raw: LogEntryInput): Promise<boolean> {
  let entry: Partial<LogEntry>
  try {
    entry = buildLogEntry(raw)
  } catch {
    // 构造阶段失败不能阻塞业务，但必须留下痕迹（仅一次，避免自我放大）。
    _warnFailure('buildLogEntry failed', raw)
    return false
  }

  // P7 M4：一次交互只落盘 1 条记录，过程步骤留在内存。
  // 正常条目只带 stepCount 摘要；error 或显式要求 dump 时才把该 trace 的
  // 最近步骤序列化进 steps（复用 P3 的同步落盘与诊断包链路）。
  if (entry.traceId) {
    if (typeof entry.stepCount !== 'number') entry.stepCount = stepCount(entry.traceId)
    const needDump = entry.category === 'error' || (Array.isArray(raw.steps) && raw.steps.length > 0)
    if (needDump && !entry.steps?.length) {
      const dumped = dumpSteps(entry.traceId)
      if (dumped.length > 0) entry.steps = dumped
    }
  }

  const api = _api()
  if (!api) {
    // 保留最早的启动期条目（诊断价值最高），溢出只记数不写日志。
    if (_pending.length < MAX_PENDING) _pending.push(entry)
    else _pendingDropped += 1
    _scheduleFlush()
    return false
  }
  try {
    const result = (await _call('log:write', entry)) as LogWriteResult | boolean | null
    if (typeof result === 'boolean') return result
    return Boolean(result?.accepted)
  } catch (error) {
    // 不再静默吞掉：一次性告警，且调用方能通过 false 感知写入失败。
    _warnFailure('log:write failed', error)
    return false
  }
}

export async function logGetBuffer(): Promise<LogEntry[]> {
  try {
    const result = await _call('log:getBuffer')
    return Array.isArray(result) ? (result as LogEntry[]) : []
  } catch (error) {
    _warnFailure('log:getBuffer failed', error)
    return []
  }
}

/** 兼容既有调用方：返回条目数组（丢弃 total）；需要分页信息用 logQueryPage。 */
export async function logQuery(opts: LogQueryInput = {}): Promise<LogEntry[]> {
  const page = await logQueryPage(opts)
  return page.entries
}

export async function logQueryPage(opts: LogQueryInput = {}): Promise<LogQueryResult> {
  try {
    const result = (await _call('log:query', {
      date: opts.date,
      keyword: opts.keyword,
      levels: opts.levels,
      actions: opts.actions,
      // v3：类别与会话过滤下推到主进程，只扫描对应的物理文件。
      categories: opts.categories,
      sessionId: opts.sessionId,
      // v3 P4：慢样本反查时只取同一 trace 的条目。
      traceId: opts.traceId,
      startTime: opts.startTime,
      endTime: opts.endTime,
      limit: opts.limit,
      offset: opts.offset,
    })) as LogQueryResult | LogEntry[] | null
    if (Array.isArray(result)) return { entries: result, total: result.length }
    return {
      entries: Array.isArray(result?.entries) ? result.entries : [],
      total: typeof result?.total === 'number' ? result.total : 0,
      parseErrors: result?.parseErrors,
    }
  } catch (error) {
    _warnFailure('log:query failed', error)
    return { entries: [], total: 0 }
  }
}

/** 只清内存缓冲，不删磁盘文件；语义与 log-service.clearBuffer 对齐。 */
export async function logClear(): Promise<boolean> {
  try {
    return Boolean(await _call('log:clearBuffer'))
  } catch (error) {
    _warnFailure('log:clearBuffer failed', error)
    return false
  }
}

export async function logGetAvailableDates(): Promise<string[]> {
  try {
    const result = await _call('log:getAvailableDates')
    return Array.isArray(result) ? (result as string[]) : []
  } catch (error) {
    _warnFailure('log:getAvailableDates failed', error)
    return []
  }
}

export async function logGetLevel(): Promise<LogLevel> {
  try {
    const level = (await _call('log:getLevel')) as LogLevel
    return (LOG_LEVELS as readonly string[]).includes(level) ? level : 'INFO'
  } catch {
    return 'INFO'
  }
}

/** 唯一等级入口：阈值只存在于主进程，设置后由 log:level 广播给所有窗口。 */
export async function logSetLevel(level: LogLevel): Promise<LogLevel> {
  try {
    const next = (await _call('log:setLevel', level)) as LogLevel
    return (LOG_LEVELS as readonly string[]).includes(next) ? next : level
  } catch (error) {
    _warnFailure('log:setLevel failed', error)
    return level
  }
}

/** 等级广播订阅者；与 log:entry 共用同一套 IPC 注册与延迟重试机制。 */
const _levelCallbacks = new Set<(level: LogLevel) => void>()

/**
 * 订阅主进程的等级变更广播，返回取消订阅函数。
 * API 尚未注入时也不返回空实现：注册会延迟重试，避免永久收不到广播。
 */
export function logSubscribeLevel(callback: (level: LogLevel) => void): () => void {
  _levelCallbacks.add(callback)
  _ensureSubscription()
  return () => { _levelCallbacks.delete(callback) }
}

export async function logGetDir(): Promise<string | null> {
  try {
    return (await _call('log:getLogDir')) as string | null
  } catch {
    return null
  }
}

/** 导出指定日期（YYYY-MM-DD）的全部分片原始 JSONL；非法日期返回空串。 */
export async function logExportJsonl(date?: string): Promise<string> {
  try {
    const result = await _call('log:export', date ?? null)
    return typeof result === 'string' ? result : ''
  } catch (error) {
    _warnFailure('log:export failed', error)
    return ''
  }
}

/**
 * P3 原始输入黑匣子镜像（D2）。走 send 而不是 invoke：不触发 preload 的 IPC 审计、
 * 不写日志、不落盘；API 未注入时静默丢弃（黑匣子允许丢，业务不受影响）。
 */
export function logPushBreadcrumbs(batch: readonly unknown[]): void {
  const api = _api()
  if (!api || !Array.isArray(batch) || batch.length === 0) return
  try { api.send('log:breadcrumbs', batch.slice(0, 50)) } catch { /* 镜像失败不影响业务 */ }
}

/** 一键诊断包（JSON 字符串）；二次脱敏与双目录汇总由主进程负责。 */
export async function logExportBundle(): Promise<string> {
  try {
    const result = await _call('log:exportBundle')
    return typeof result === 'string' ? result : ''
  } catch (error) {
    _warnFailure('log:exportBundle failed', error)
    return ''
  }
}

// ------------------------------------------------------------
// 订阅：log:entry 实时推送
// ------------------------------------------------------------
const _listeners = new Set<(entry: LogEntry) => void>()
let _ipcHandler: ((entry: unknown) => void) | null = null
let _levelHandler: ((value: unknown) => void) | null = null
let _ipcRegistered = false
let _subscribeSent = false
let _subscriptionTimer: ReturnType<typeof setTimeout> | null = null
let _subscriptionAttempts = 0

function _dispatchToListeners(entry: LogEntry) {
  for (const cb of _listeners) {
    try { cb(entry) } catch { /* 单个订阅者异常不影响其他订阅者 */ }
  }
}

function _dispatchLevel(value: unknown) {
  if (!(LOG_LEVELS as readonly string[]).includes(value as string)) return
  for (const cb of _levelCallbacks) {
    try { cb(value as LogLevel) } catch { /* 单个订阅者异常不影响其他订阅者 */ }
  }
}

/** API 未注入时延迟重试，且只有真正注册成功才置 _ipcRegistered。 */
function _scheduleSubscriptionRetry() {
  if (_subscriptionTimer || typeof window === 'undefined') return
  if (_subscriptionAttempts >= 20) return
  const delay = Math.min(120 * 2 ** Math.min(_subscriptionAttempts, 5), 4000)
  _subscriptionAttempts += 1
  _subscriptionTimer = setTimeout(() => {
    _subscriptionTimer = null
    _ensureSubscription()
  }, delay)
}

function _ensureSubscription() {
  const api = _api()
  if (!api) {
    _scheduleSubscriptionRetry()
    return
  }
  if (!_ipcRegistered) {
    _ipcHandler = (entry: unknown) => _dispatchToListeners(entry as LogEntry)
    _levelHandler = (value: unknown) => _dispatchLevel(value)
    api.on('log:entry', _ipcHandler)
    api.on('log:level', _levelHandler)
    _ipcRegistered = true
    _subscriptionAttempts = 0
    // 注册可能晚于主进程上一次等级设置，主动同步一次当前值。
    void logGetLevel().then(_dispatchLevel).catch(() => {})
  }
  // 重新订阅时 handler 可能已注册过，仍必须补发 log:subscribe。
  if (_listeners.size > 0 && !_subscribeSent) {
    api.send('log:subscribe')
    _subscribeSent = true
  }
}

export function logSubscribe(callback: (entry: LogEntry) => void): void {
  _listeners.add(callback)
  _ensureSubscription()
}

export function logUnsubscribe(callback: (entry: LogEntry) => void): void {
  _listeners.delete(callback)

  if (_listeners.size === 0 && _subscribeSent) {
    const api = _api()
    if (api) api.send('log:unsubscribe')
    _subscribeSent = false
  }

  if (_listeners.size === 0 && _levelCallbacks.size === 0 && _ipcRegistered) {
    const api = _api()
    if (api) {
      if (_ipcHandler) api.off('log:entry', _ipcHandler)
      if (_levelHandler) api.off('log:level', _levelHandler)
    }
    _ipcHandler = null
    _levelHandler = null
    _ipcRegistered = false
  }
}

/**
 * 构造并写入一条关键动作日志。
 *
 * 兼容期签名保持不变：`logAction(action, module, params)`。
 * P2 T2.4 起业务调用点统一传规范 id；中文字符串只保留在 LEGACY_ACTION_MAP
 * 中供旧日志与插件 API 兼容，源码里禁止再出现（门禁 C10 冻结线 = 0）。
 * module 会自动归一化到 LOG_MODULES 功能域；级别由注册表决定。
 *
 * @example
 *   await logAction('node.create', 'graph', { nodeId: 'auto-123' })
 */
export interface LogActionOptions {
  /** P7：产生点显式声明事实类型，覆盖按 action 前缀推断的 category。 */
  kind?: LogFactKind
  /** P7：显式独立事件（null）或指定 trace；默认跟随交互窗口。 */
  traceId?: string | null
}

export async function logAction(
  action: string,
  module = 'App',
  params: Record<string, unknown> = {},
  opts: LogActionOptions = {},
): Promise<boolean> {
  const resolved = resolveAction(action)
  const cleaned: Record<string, unknown> = { ...params }
  if (!resolved.registered) {
    cleaned.rawAction = action
  }
  // 保留中文 label 便于 UI 过渡期对照；业务调用点迁移完成后可移除。
  if (resolved.legacy) cleaned.actionLabel = resolved.label

  // v3 §8 单点收口：所有 logAction 产生的用户事件都必须带 target / result，
  // traceId 由 buildLogEntry 从当前作用域取（没有作用域时才现场生成）。
  // 关键动作会把结构化 target 与 result 放进 params，这里提出来升为一级字段。
  const rawTarget = cleaned.target
  delete cleaned.target
  const target: LogTarget = rawTarget && typeof rawTarget === 'object' && !Array.isArray(rawTarget)
    ? (rawTarget as LogTarget)
    : { type: resolved.module }
  const result = typeof cleaned.result === 'string'
    ? cleaned.result
    : (resolved.level === 'ERROR' || /_failed$/.test(resolved.id) ? 'failure' : 'success')

  return logWrite({
    // 未注册 action 记 WARN（而不是额外再写一条），便于门禁与人工巡检发现漏登记。
    level: resolved.registered ? resolved.level : 'WARN',
    module: resolved.module === 'app' ? module : resolved.module,
    action: resolved.id === UNKNOWN_ACTION_ID ? UNKNOWN_ACTION_ID : resolved.id,
    message: resolved.label,
    params: cleaned,
    target,
    result,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.traceId !== undefined ? { traceId: opts.traceId } : {}),
  })
}
