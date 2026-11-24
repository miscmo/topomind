/**
 * 原始输入黑匣子（v3 D2）。
 *
 * 「鼠标点击 xxx」这类逐事件数据只在内存里保留 2000 条环形缓冲，平时零磁盘成本；
 * 每 500ms（或满 20 条）批量镜像到主进程内存，主进程在写 error / 崩溃恢复报告时
 * 把最近 50 条作为 breadcrumbs **同步** dump 到 error 日志。任何情况下都不单独落盘。
 *
 * 隐私约束（D3）：不记按键值、输入正文、文档标题、节点名、明文路径；
 * aria-label / title 只保留长度摘要。本文件禁止写 console（C6 冻结线零余量），
 * 也禁止调用 invoke（preload 的 IPC 审计只覆盖 invoke，但日志通道必须彻底旁路）。
 */
import { logPushBreadcrumbs } from './log-backend.ts'

const MAX_BUFFER_SIZE = 2000
const MIRROR_BATCH = 20
const MIRROR_INTERVAL_MS = 500
const INPUT_THROTTLE_MS = 100

export interface BlackboxEvent {
  t: number
  type: string
  target?: { tag?: string; id?: string; role?: string; label?: string }
  view?: string
  seq: number
}

let _buffer: BlackboxEvent[] = []
let _bufferIndex = 0
let _wrapped = false
let _seq = 0
let _pending: BlackboxEvent[] = []
let _installed = false
let _timer: ReturnType<typeof setInterval> | null = null
const _lastAt = new Map<string, number>()

function _view(): string {
  try {
    // 只取应用路由 pathname；query / hash 可能带文档 id 或用户参数，不进面包屑。
    return window.location.pathname.slice(0, 80)
  } catch {
    return 'app'
  }
}

function _describeTarget(raw: EventTarget | null): BlackboxEvent['target'] | undefined {
  if (!raw || typeof Element === 'undefined' || !(raw instanceof Element)) return undefined
  const id = raw.getAttribute('id')
  const role = raw.getAttribute('role')
  const label = raw.getAttribute('aria-label') ?? raw.getAttribute('title')
  return {
    tag: raw.tagName.toLowerCase(),
    ...(id ? { id: id.slice(0, 80) } : {}),
    ...(role ? { role: role.slice(0, 40) } : {}),
    // D3：控件文案只记长度，不记标题/节点名。
    ...(label ? { label: `[length:${label.length}]` } : {}),
  }
}

function _push(item: BlackboxEvent) {
  if (_buffer.length < MAX_BUFFER_SIZE) _buffer.push(item)
  else {
    _buffer[_bufferIndex] = item
    _wrapped = true
  }
  _bufferIndex = (_bufferIndex + 1) % MAX_BUFFER_SIZE
}

function _record(type: string, event: Event) {
  const now = Date.now()
  if (type === 'scroll' || type === 'wheel') {
    const last = _lastAt.get(type) ?? 0
    if (now - last < INPUT_THROTTLE_MS) return
    _lastAt.set(type, now)
  }
  _seq += 1
  const target = _describeTarget(event.target)
  const item: BlackboxEvent = {
    t: now,
    type,
    seq: _seq,
    view: _view(),
    ...(target ? { target } : {}),
  }
  _push(item)
  _pending.push(item)
  if (_pending.length >= MIRROR_BATCH) flushBlackbox()
}

/** 把未镜像的事件批量送到主进程内存缓冲；API 未注入时静默丢弃（黑匣子允许丢）。 */
export function flushBlackbox(): void {
  if (_pending.length === 0) return
  const batch = _pending
  _pending = []
  try { logPushBreadcrumbs(batch) } catch { /* 黑匣子不得影响业务 */ }
}

/** 按时间顺序返回最近 limit 条，供渲染侧排障与门禁用例使用。 */
export function getBreadcrumbs(limit = 50): BlackboxEvent[] {
  const ordered = _wrapped
    ? [..._buffer.slice(_bufferIndex), ..._buffer.slice(0, _bufferIndex)]
    : [..._buffer]
  return ordered.slice(-Math.max(1, limit))
}

/** 仅用于测试与会话重置；不会清主进程缓冲。 */
export function resetBlackbox(): void {
  _buffer = []
  _bufferIndex = 0
  _wrapped = false
  _seq = 0
  _pending = []
  _lastAt.clear()
}

/**
 * 安装 DOM 采集。Node 回归脚本里没有 window/document 时直接返回空卸载函数，
 * 且定时器 unref，避免 P0 曾出现的「永动定时器让门禁进程无法退出」。
 */
export function installBlackbox(): () => void {
  if (_installed || typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  _installed = true
  const handlers: Array<[string, (event: Event) => void]> = []
  for (const type of ['pointerdown', 'keydown', 'scroll', 'wheel']) {
    const handler = (event: Event) => {
      try { _record(type, event) } catch { /* 采集失败必须静默 */ }
    }
    handlers.push([type, handler])
    document.addEventListener(type, handler, { capture: true, passive: true })
  }
  _timer = setInterval(() => {
    try { flushBlackbox() } catch { /* 镜像失败必须静默 */ }
  }, MIRROR_INTERVAL_MS)
  const timer = _timer as unknown as { unref?: () => void } | null
  if (timer?.unref) timer.unref()
  return () => {
    for (const [type, handler] of handlers) document.removeEventListener(type, handler, true)
    if (_timer) clearInterval(_timer)
    _timer = null
    _installed = false
    try { flushBlackbox() } catch { /* 卸载时尽力镜像 */ }
  }
}
