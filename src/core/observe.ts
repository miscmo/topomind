/**
 * P2 单点拦截层统一采集 API（渲染进程）。
 *
 * 目标：业务调用点不再手写日志，而是由 IPC / 命令 / 插件 / 定时器 / 用户动作
 * 五类拦截点统一调用本模块，自动补齐 v3 的 category、target、result、
 * traceId / spanId / parentId、durationMs、source、outcome。
 *
 * 关键设计：
 *  - `withTraceId` / `withSpan` 是同步作用域，`await` 之后会复位，无法承载
 *    跨异步的因果链。这里改用**显式操作上下文栈**：beginOperation 记录根
 *    span，recordInternal 用 withSpanContext 恢复它再嵌一个子 span，因此
 *    一次用户操作下的 N 条内部日志共享 traceId，且各有独立 spanId。
 *  - 拦截层自身不写日志之外的 IPC；日志通道由 preload 审计显式排除，
 *    不存在 `invoke → 日志 → invoke` 自放大。
 *  - 定时器汇总完全惰性（tick 时检查时间窗），不创建后台定时器，
 *    避免 Node 回归脚本里出现永动 timer。
 */
import { writeEntry } from './logger.ts'
import {
  LOG_ACTIONS,
  getActionSpec,
  getCurrentTraceId,
  startInteraction,
  type LogEntryInput,
  type LogLevel,
  type LogTarget,
} from '../shared/observability/logContract.ts'
import {
  newTraceId,
  newSpanId,
  withSpan,
  withSpanContext,
} from '../shared/observability/session.ts'

export interface OperationContext {
  traceId: string
  /** 根 span：一次用户操作的所有内部子 span 都以它为 parentId。 */
  spanId: string
  parentId: string | null
  name: string
}

const _operationStack: OperationContext[] = []

/** 把当前 trace 镜像给 preload，让跨进程 IPC 审计能落到同一条因果链上。P7.2 起供交互边界复用。 */
export function syncTraceContext(traceId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const api = window.electronAPI
    if (api && typeof api.setTraceContext === 'function') api.setTraceContext(traceId)
  } catch {
    // 非 Electron 环境（回归脚本、Vite 浏览器预览）忽略。
  }
}

export function currentOperation(): OperationContext | null {
  return _operationStack.length > 0 ? _operationStack[_operationStack.length - 1] : null
}

/** 开始一次操作；嵌套操作复用父 traceId，只新开一层 span。 */
export function beginOperation(name: string): OperationContext {
  const parent = currentOperation()
  const ctx: OperationContext = {
    // P7.2：显式操作也复用交互边界生成的 traceId，命令链不再自成一条平行链。
    traceId: parent?.traceId ?? getCurrentTraceId() ?? newTraceId(name),
    spanId: newSpanId(name),
    parentId: parent?.spanId ?? null,
    name,
  }
  _operationStack.push(ctx)
  syncTraceContext(ctx.traceId)
  // P5：显式作用域同时开一个惰性交互窗口，让 await 之后的普通 logAction /
  // log.info 也能落到同一条链（withTraceId 的同步作用域覆盖不到异步回调）。
  startInteraction(ctx.traceId)
  return ctx
}

export function endOperation(ctx: OperationContext): void {
  const index = _operationStack.lastIndexOf(ctx)
  if (index >= 0) _operationStack.splice(index, 1)
  syncTraceContext(currentOperation()?.traceId ?? null)
  // 不主动 endInteraction：窗口按时间戳自然过期，覆盖操作结束后的渲染 / 落盘
  // 尾声；下一次用户事件或 beginOperation 会覆盖它。
}

export interface InternalEventInput {
  action: string
  message?: string
  label?: string
  level?: LogLevel | string
  module?: string
  params?: Record<string, unknown> | null
  source?: string
  outcome?: string
  result?: string
  durationMs?: number
  error?: unknown
  target?: LogTarget | null
  traceId?: string | null
  /** 子 span 名称，默认取 action。 */
  spanName?: string
}

/**
 * 写一条内部事件。category 交给契约的 categoryFromLegacy 推断：
 * `ipc.` / `plugin.` / `app.` / `timer.` / `store.` → internal，
 * ERROR 或 `_failed` 后缀自动落到 error 类，不需要调用方手填。
 */
export function recordInternal(input: InternalEventInput): Promise<boolean> {
  const spec = getActionSpec(input.action)
  const ctx = currentOperation()
  const entry: LogEntryInput = {
    level: input.level ?? spec?.level ?? 'INFO',
    action: input.action,
    module: input.module ?? spec?.module ?? 'app',
    message: input.message ?? spec?.label,
    label: input.label ?? spec?.label,
    params: input.params ?? null,
    source: input.source,
    outcome: input.outcome,
    result: input.result,
    durationMs: input.durationMs,
    error: input.error,
    target: input.target ?? null,
    // P5 三态：null = 显式独立（周期聚合），undefined = 跟随交互窗口。
    traceId: input.traceId === null ? null : (input.traceId ?? ctx?.traceId ?? undefined),
  }
  const emit = () => withSpan(input.spanName || input.action, () => writeEntry(entry))
  if (ctx) return withSpanContext(ctx.spanId, ctx.parentId, emit)
  return emit()
}

export interface UserEventOptions {
  target?: LogTarget | null
  result?: string
  params?: Record<string, unknown> | null
  view?: string
  from?: string
  to?: string
  inputMode?: string
  durationMs?: number
  message?: string
  label?: string
  level?: LogLevel | string
  traceId?: string | null
}

/** 语义化用户事件：target / result / trace 三项强制齐全（v3 §8 验收）。 */
export function recordUser(actionId: string, opts: UserEventOptions = {}): Promise<boolean> {
  const spec = getActionSpec(actionId)
  const ctx = currentOperation()
  // P7.2：交互边界已在真实输入瞬间生成 traceId，这里只复用，不再各自 newTraceId。
  // 无边界时（程序化调用 / Node 门禁）才兜底新建，保证链路仍然完整。
  // 随后的 logAction / IPC 明细 / 内部事件自动共享同一条链，106 处埋点无需
  // 逐个改造，也不会出现「语义事件排在第三位导致前两条另起 trace」。
  const traceId = opts.traceId === null
    ? null
    : (opts.traceId ?? ctx?.traceId ?? getCurrentTraceId() ?? newTraceId(actionId))
  if (traceId) {
    startInteraction(traceId)
    syncTraceContext(traceId)
  }
  const extras: Record<string, unknown> = { ...(opts.params ?? {}) }
  if (opts.view) extras.view = opts.view
  if (opts.from) extras.from = opts.from
  if (opts.to) extras.to = opts.to
  if (opts.inputMode) extras.inputMode = opts.inputMode

  const entry: LogEntryInput = {
    level: opts.level ?? spec?.level ?? 'INFO',
    action: actionId,
    module: spec?.module ?? 'ui',
    message: opts.message ?? spec?.label ?? actionId,
    label: opts.label ?? spec?.label,
    target: opts.target ?? { type: spec?.module ?? 'app' },
    result: opts.result ?? 'success',
    durationMs: opts.durationMs,
    params: Object.keys(extras).length > 0 ? extras : null,
    traceId,
  }
  // 在 observeOperation 作用域内，用户事件本身就是根 span；内部日志通过
  // recordInternal 嵌套 withSpan 成为它的子 span，从而形成瀑布层级。
  if (ctx) return withSpanContext(ctx.spanId, ctx.parentId, () => writeEntry(entry))
  return withSpan(actionId, () => writeEntry(entry))
}

/**
 * 包一次用户操作：fn 期间产生的所有内部日志自动挂到同一 trace；
 * 完成后只写一条 user 日志（带耗时与结果），不逐条记流水。
 */
export async function observeOperation<T>(
  actionId: string,
  opts: UserEventOptions,
  fn: (ctx: OperationContext) => Promise<T>,
): Promise<T> {
  const ctx = beginOperation(actionId)
  const startedAt = Date.now()
  let outcome = 'success'
  try {
    return await fn(ctx)
  } catch (err) {
    outcome = 'failure'
    throw err
  } finally {
    void recordUser(actionId, {
      ...opts,
      result: opts.result ?? outcome,
      durationMs: Date.now() - startedAt,
    })
    endOperation(ctx)
  }
}

export interface TimerAudit {
  readonly name: string
  tick(outcome?: string, durationMs?: number): void
  flush(): void
}

/**
 * 定时任务按分钟聚合：平时只在内存累加，跨过时间窗才写一条
 * `timer.aggregate`，避免 1s 轮询把日志刷成洪水（v3 §4）。
 */
export function createTimerAudit(name: string, windowMs = 60_000): TimerAudit {
  let windowStart = Date.now()
  let runs = 0
  let totalMs = 0
  let maxMs = 0
  let failures = 0

  const flush = () => {
    const elapsed = Date.now() - windowStart
    windowStart = Date.now()
    if (runs === 0) return
    void recordInternal({
      action: LOG_ACTIONS.timerAggregate,
      source: 'timer',
      outcome: failures > 0 ? 'partial' : 'success',
      result: failures > 0 ? 'partial' : 'success',
      // 60s 窗口内的调用可能横跨几十次用户操作，强行归属会伪造因果。
      traceId: null,
      params: {
        timer: name,
        runs,
        windowMs: elapsed,
        avgMs: Math.round(totalMs / runs),
        maxMs,
        failures,
      },
    })
    runs = 0
    totalMs = 0
    maxMs = 0
    failures = 0
  }

  return {
    name,
    flush,
    tick(outcome = 'success', durationMs = 0) {
      runs += 1
      totalMs += Math.max(0, durationMs)
      if (durationMs > maxMs) maxMs = durationMs
      if (outcome !== 'success') failures += 1
      if (Date.now() - windowStart >= windowMs) flush()
    },
  }
}

/** 把 setInterval 回调包成「带聚合审计」的回调，调用点只需换一个函数引用。 */
export function auditInterval(name: string, fn: () => void, windowMs = 60_000): () => void {
  const audit = createTimerAudit(name, windowMs)
  return () => {
    const startedAt = Date.now()
    try {
      fn()
      audit.tick('success', Date.now() - startedAt)
    } catch (err) {
      audit.tick('failure', Date.now() - startedAt)
      throw err
    }
  }
}
