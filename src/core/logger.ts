/**
 * 统一日志采集入口（渲染进程）。
 *
 * 规范 §3.5：业务代码、插件 LoggingApi、ErrorBoundary、性能埋点、全局异常
 * 最终都调用 writeEntry → logWrite → buildLogEntry（唯一构造入口）→ IPC。
 *
 * 与旧实现的差异：
 *  - 渲染侧不再持有等级阈值（唯一阈值在主进程），debug/info 不再是死代码；
 *  - console 镜像只在开发构建启用，四个级别行为一致；
 *  - catch 内部转 ERROR 并填充结构化 error 字段，不再把异常拼进 message；
 *  - 参数序列化走契约的 safeStringify/redact，循环引用不会抛错。
 */
import {
  logAction,
  logSetLevel,
  logSubscribeLevel,
  logWrite,
} from './log-backend.ts'
import {
  normalizeError,
  safeStringify,
  type LogEntryInput,
  type LogLevel,
} from '../shared/observability/logContract.ts'
import { getCurrentTraceId } from '../shared/observability/trace.ts'

export type { LogEntryInput }

/** Vite 开发构建才有 console 镜像；Node 回归脚本里 import.meta.env 不存在。 */
const IS_DEV = (() => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
})()

type LegacyLevel = 'debug' | 'info' | 'warn' | 'error'
const LEGACY_TO_LEVEL: Record<LegacyLevel, LogLevel> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

function _toLevel(level: LegacyLevel | LogLevel): LogLevel {
  const lower = String(level).toLowerCase() as LegacyLevel
  return LEGACY_TO_LEVEL[lower] ?? 'INFO'
}

/** 主进程广播回来的当前等级，仅用于 getLevel() 展示，不参与过滤。 */
let _reportedLevel: LogLevel = 'INFO'
try {
  logSubscribeLevel((next) => { _reportedLevel = next })
} catch {
  // 非浏览器环境（回归脚本）没有 IPC，忽略即可。
}

function _stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'object') return safeStringify(arg)
  return String(arg)
}

/** 兼容旧的 `logger.warn(module, ...args)` 变参写法，同时把对象参数结构化。 */
function _extract(args: unknown[]): { message: string; params?: Record<string, unknown> } {
  const message = args.map(_stringifyArg).join(' ')
  const structured = args.filter(
    (arg) => arg !== null && typeof arg === 'object' && !(arg instanceof Error),
  )
  return {
    message,
    ...(structured.length > 0 ? { params: { args: structured } } : {}),
  }
}

function _mirror(level: LogLevel | string, module: string | undefined, input: LogEntryInput): void {
  if (!IS_DEV) return
  const normalized = _toLevel(level as LogLevel)
  const prefix = `[${module ?? 'app'}][${normalized}]`
  const payload: unknown[] = [prefix, input.message ?? input.action ?? '']
  if (input.error !== undefined) payload.push(input.error)
  if (input.params) payload.push(input.params)
  switch (normalized) {
    case 'DEBUG': console.debug(...payload); break
    case 'INFO': console.info(...payload); break
    case 'WARN': console.warn(...payload); break
    case 'ERROR': console.error(...payload); break
  }
}

/**
 * 所有来源共用的写入入口。字段规整由 buildLogEntry 负责，这里只做
 * traceId 透传与开发期 console 镜像。
 */
export function writeEntry(input: LogEntryInput): Promise<boolean> {
  const entry: LogEntryInput = {
    ...input,
    // P5 三态：null 是「显式独立」，不能被 ?? 悄悄回落到当前交互窗口，
    // 否则周期聚合 / 主进程日志会被误归到最近一次点击的链路。
    traceId: input.traceId === null ? null : (input.traceId ?? getCurrentTraceId() ?? undefined),
  }
  _mirror(input.level ?? 'INFO', input.module, entry)
  return logWrite(entry)
}

export const logger = {
  /** 兼容旧签名；实际把等级设置转发给主进程（唯一等级源）。 */
  setLevel(level: LegacyLevel | LogLevel): void {
    const next = _toLevel(level)
    _reportedLevel = next
    void logSetLevel(next)
  },

  /** 返回主进程当前等级（小写，兼容旧调用方）。 */
  getLevel(): LegacyLevel {
    return _reportedLevel.toLowerCase() as LegacyLevel
  },

  debug(module: string, ...args: unknown[]): Promise<boolean> {
    return writeEntry({ level: 'DEBUG', module, ..._extract(args) })
  },

  info(module: string, ...args: unknown[]): Promise<boolean> {
    return writeEntry({ level: 'INFO', module, ..._extract(args) })
  },

  warn(module: string, ...args: unknown[]): Promise<boolean> {
    return writeEntry({ level: 'WARN', module, ..._extract(args) })
  },

  error(module: string, ...args: unknown[]): Promise<boolean> {
    const err = args.find((arg) => arg instanceof Error)
    return writeEntry({
      level: 'ERROR',
      module,
      ..._extract(args),
      ...(err !== undefined ? { error: err } : {}),
    })
  },

  /** 兼容 96 处既有调用：`catch(module, context, err, params?)`。 */
  catch(module: string, context: string, err?: unknown, params?: Record<string, unknown>): Promise<boolean> {
    const info = normalizeError(err)
    return writeEntry({
      level: 'ERROR',
      module,
      message: `${context}失败: ${info?.message ?? '未知错误'}`,
      error: err,
      params: { context, ...(params ?? {}) },
    })
  },

  /** §3.5 规范入口：`logger.action(LOG_ACTIONS.nodeCreate, { nodeId })`。 */
  action(actionId: string, params: Record<string, unknown> = {}, module = 'App'): Promise<boolean> {
    return logAction(actionId, module, params)
  },
}

export default logger
