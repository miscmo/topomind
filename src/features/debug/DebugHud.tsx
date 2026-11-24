/**
 * Debug HUD：应用内最顶层的实时日志浮窗（P6 / D18）。
 *
 * 与「系统日志」监控页的分工：
 * - 监控页 = 历史回放 / 因果链 / 崩溃分析，需要切换视图；
 * - Debug HUD = 实时示波器，开着窗口就能看到软件此刻在做什么。
 *
 * 三条硬约束：
 * 1. 只订阅 `log:entry`，**绝不写日志**（否则 log:write -> log:entry -> HUD -> log:write 自我放大）；
 * 2. 只在内存里留最近 300 条，不落盘、不进主进程缓冲，关闭即释放；
 * 3. 实时流按 80ms 合帧批量渲染，高频日志不会每条触发一次 React 更新。
 *
 * P8 透明背景：标题栏「透明」按钮开启半透明表面并联动真穿透（root 级
 * pointer-events:none，控制条显式 auto）。鼠标移到控制条时临时恢复不透明，
 * 保证想读日志时仍读得清；所有视觉值来自 tokens.css 三套主题变量。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  Bug, ChevronDown, ChevronUp, Copy, Droplet, ExternalLink, Pause, Play, Trash2, X,
} from 'lucide-react'
import { TM_UI, tmUI } from '../../shared/ui/controlStyles'
import { logGetBuffer, logSubscribe, logUnsubscribe } from '../../core/log-backend'
import { executeCommand } from '../../application/commands'
import type { LogEntry } from '../../shared/observability/logContract'
import { useDebugHudStore, type DebugHudBounds } from './debugStore'
import {
  debugHudLogTextShadow,
  debugHudRootPointerEvents,
  debugHudSurfaceStyle,
} from './debugSurface'
import {
  DEBUG_HUD_CATEGORIES,
  DEBUG_HUD_FLUSH_MS,
  DEBUG_HUD_LEVELS,
  DEBUG_HUD_LIMIT,
  DEBUG_HUD_PAUSE_LIMIT,
  appendDebugEntries,
  debugCategoryOf,
  debugClock,
  debugEntryDetail,
  debugEntryTitle,
  debugLevelOf,
  matchesDebugFilters,
  shortTraceId,
  summarizeDebugEntries,
} from './debugLogBuffer'

const CATEGORY_COLOR: Record<string, string> = {
  user: 'var(--color-primary)',
  internal: 'var(--color-text-secondary)',
  performance: 'var(--color-accent)',
  error: 'var(--color-danger)',
}
const CATEGORY_LABEL: Record<string, string> = {
  user: '用户',
  internal: '内部',
  performance: '性能',
  error: '异常',
}
const LEVEL_COLOR: Record<string, string> = {
  DEBUG: 'var(--color-text-muted)',
  INFO: 'var(--color-primary)',
  WARN: 'var(--color-warning)',
  ERROR: 'var(--color-danger)',
}
const LEVEL_SHORT: Record<string, string> = { DEBUG: 'DBG', INFO: 'INF', WARN: 'WRN', ERROR: 'ERR' }

type DragKind = 'move' | 'resize'
interface DragState {
  kind: DragKind
  startX: number
  startY: number
  origin: DebugHudBounds
}

/** 首次显示时贴视口右下角，避开左上角的标题栏菜单；之后按用户拖动的位置恢复。 */
function resolveBounds(saved: DebugHudBounds): DebugHudBounds {
  if (saved.x >= 0 && saved.y >= 0) return saved
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  return {
    ...saved,
    x: Math.max(8, vw - saved.width - 20),
    y: Math.max(8, vh - saved.height - 20),
  }
}

function entryKey(entry: LogEntry, index: number): string {
  return entry.id ?? `${entry.timestamp ?? ''}#${entry.seq ?? index}#${entry.action ?? ''}`
}

export default memo(function DebugHud() {
  const store = useDebugHudStore()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [dragBounds, setDragBounds] = useState<DebugHudBounds | null>(null)
  /** 鼠标停在控制条上时临时恢复不透明，方便读日志；移开后继续半透明。 */
  const [hovered, setHovered] = useState(false)
  const latestBoundsRef = useRef<DebugHudBounds | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pausedRef = useRef(store.paused)
  const listRef = useRef<HTMLDivElement>(null)
  pausedRef.current = store.paused

  const bounds = dragBounds ?? resolveBounds(store.bounds)

  // 首次定位后写回一次，后续拖动起点才是真实坐标而不是 -1 哨兵。
  useEffect(() => {
    if (store.bounds.x >= 0 && store.bounds.y >= 0) return
    const resolved = resolveBounds(store.bounds)
    useDebugHudStore.getState().setBounds({ x: resolved.x, y: resolved.y })
  }, [store.bounds.x, store.bounds.y])

  // 只在开启期间订阅：历史缓冲 + 实时推送走同一条合帧队列。
  useEffect(() => {
    if (!store.enabled) return
    let alive = true
    const pending: LogEntry[] = []
    let timer: ReturnType<typeof setTimeout> | null = null

    // 函数声明互相引用（flush 在暂停时重新调度），用声明提升避免 TDZ。
    function schedule(): void {
      if (!timer) timer = setTimeout(flush, DEBUG_HUD_FLUSH_MS)
    }
    function flush(): void {
      timer = null
      if (!alive) return
      if (pausedRef.current) {
        if (pending.length > DEBUG_HUD_PAUSE_LIMIT) {
          pending.splice(0, pending.length - DEBUG_HUD_PAUSE_LIMIT)
        }
        schedule()
        return
      }
      if (pending.length === 0) return
      const batch = pending.splice(0, pending.length)
      setEntries((previous) => appendDebugEntries(previous, batch))
    }
    const onEntry = (entry: LogEntry) => {
      pending.push(entry)
      schedule()
    }

    void logGetBuffer().then((buffer) => {
      if (!alive || !Array.isArray(buffer)) return
      pending.push(...buffer.slice(-DEBUG_HUD_LIMIT))
      schedule()
    })
    logSubscribe(onEntry)

    return () => {
      alive = false
      logUnsubscribe(onEntry)
      if (timer) clearTimeout(timer)
      pending.length = 0
    }
  }, [store.enabled])

  const visible = useMemo(
    () => entries.filter((entry) => matchesDebugFilters(entry, {
      levels: store.levels,
      categories: store.categories,
      keyword: store.keyword,
    })),
    [entries, store.levels, store.categories, store.keyword],
  )
  const summary = useMemo(() => summarizeDebugEntries(entries), [entries])

  useEffect(() => {
    if (!store.autoScroll || store.paused || store.collapsed) return
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [visible, store.autoScroll, store.paused, store.collapsed])

  // ---- 拖动 / 调整大小：pointer capture，避免 frameless 窗口的 drag region 吞事件 ----
  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, kind: DragKind) => {
    if (kind === 'move' && event.target instanceof Element && event.target.closest('button')) return
    dragRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: bounds,
    }
    latestBoundsRef.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [bounds])

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const vw = window.innerWidth
    const vh = window.innerHeight
    let next: DebugHudBounds
    if (drag.kind === 'move') {
      next = {
        ...drag.origin,
        x: Math.min(Math.max(0, drag.origin.x + dx), Math.max(0, vw - 120)),
        y: Math.min(Math.max(0, drag.origin.y + dy), Math.max(0, vh - 40)),
      }
    } else {
      next = {
        ...drag.origin,
        width: Math.min(Math.max(280, drag.origin.width + dx), Math.max(280, vw - drag.origin.x - 8)),
        height: Math.min(Math.max(120, drag.origin.height + dy), Math.max(120, vh - drag.origin.y - 8)),
      }
    }
    latestBoundsRef.current = next
    setDragBounds(next)
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const next = latestBoundsRef.current
    latestBoundsRef.current = null
    setDragBounds(null)
    if (next) {
      useDebugHudStore.getState().setBounds({
        x: next.x, y: next.y, width: next.width, height: next.height,
      })
    }
  }, [])

  const handleCopy = useCallback(() => {
    try {
      void navigator.clipboard?.writeText(JSON.stringify(visible, null, 2))?.catch(() => {})
    } catch {
      // 剪贴板不可用时静默降级，不写日志（见文件头硬约束）
    }
  }, [visible])

  const openMonitor = useCallback(() => {
    void executeCommand('monitor.open').catch(() => {})
  }, [])

  // 宿主已按 enabled 条件挂载；这里再守一道，防止将来有人直接渲染本组件时静默订阅。
  if (!store.enabled) return null

  const rootStyle: CSSProperties = {
    // inline 优先级最高，避免 .tm-popover 自带的定位覆盖 fixed。
    position: 'fixed',
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: store.collapsed ? undefined : bounds.height,
    zIndex: 'var(--z-debug-hud)',
    WebkitAppRegion: 'no-drag',
    // P8：穿透要落在 root 上，否则有背景的浮层仍会截获点击，下层界面点不到。
    // 标题栏 / 过滤条 / 缩放手柄在下面显式恢复 auto，保留操作入口。
    pointerEvents: debugHudRootPointerEvents(store.clickThrough),
    ...debugHudSurfaceStyle({ translucent: store.translucent, hovered }),
  }

  return (
    <div
      data-tm-debug-hud=""
      data-tm-debug-translucent={store.translucent ? '' : undefined}
      className={tmUI('fixed flex flex-col', TM_UI.popover)}
      style={rootStyle}
    >
      <div
        className="flex items-center gap-1.5 px-2 shrink-0 cursor-move"
        style={{
          height: 30,
          borderBottom: '1px solid var(--color-border-subtle)',
          userSelect: 'none',
          touchAction: 'none',
          pointerEvents: 'auto',
        }}
        title="拖动移动窗口 · 右下角可调整大小 · 调试窗口可能显示路径与文档标题，截图请注意"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(e) => startDrag(e, 'move')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Bug className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-danger)' }} aria-hidden="true" />
        <span className="font-semibold shrink-0" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>DEBUG</span>
        <span className="shrink-0 tabular-nums" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {summary.total} 条
        </span>
        {summary.errors > 0 && (
          <span className="shrink-0 tabular-nums" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
            {summary.errors} 错误
          </span>
        )}
        {store.paused && (
          <span className="shrink-0" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>已暂停</span>
        )}
        <span className="flex-1 min-w-0" />
        <button type="button" className={TM_UI.iconButton} aria-label={store.paused ? '恢复实时流' : '暂停实时流'} title={store.paused ? '恢复实时流' : '暂停并定格当前画面'} onClick={() => store.setPaused(!store.paused)}>
          {store.paused ? <Play className={TM_UI.icon} aria-hidden="true" /> : <Pause className={TM_UI.icon} aria-hidden="true" />}
        </button>
        <button type="button" className={TM_UI.iconButton} aria-label="清空窗口" title="只清空浮窗显示，不影响磁盘日志" onClick={() => { setEntries([]); setExpandedKey(null) }}>
          <Trash2 className={TM_UI.icon} aria-hidden="true" />
        </button>
        <button type="button" className={store.translucent ? TM_UI.buttonActive : TM_UI.iconButton} aria-label="透明背景" aria-pressed={store.translucent} title="半透明背景 + 点击穿透：看得见下层、也点得到下层；鼠标移到控制条时临时恢复不透明" onClick={() => store.setTranslucent(!store.translucent)}>
          <Droplet className={TM_UI.icon} aria-hidden="true" />
        </button>
        <button type="button" className={store.clickThrough ? TM_UI.buttonActive : TM_UI.iconButton} aria-label="点击穿透" aria-pressed={store.clickThrough} title="浮窗整体不拦截鼠标（控制条除外），日志行暂不可点击展开" onClick={() => store.setClickThrough(!store.clickThrough)}>
          <span className="select-none" style={{ fontSize: 'var(--font-size-xs)' }}>穿透</span>
        </button>
        <button type="button" className={store.detailed ? TM_UI.buttonActive : TM_UI.iconButton} aria-label="详细模式" aria-pressed={store.detailed} title="允许点击日志行展开 params / error 详情（默认关）" onClick={() => { store.setDetailed(!store.detailed); setExpandedKey(null) }}>
          <span className="select-none" style={{ fontSize: 'var(--font-size-xs)' }}>详情</span>
        </button>
        <button type="button" className={TM_UI.iconButton} aria-label={store.collapsed ? '展开窗口' : '折叠窗口'} title={store.collapsed ? '展开' : '折叠成小胶囊'} onClick={() => store.setCollapsed(!store.collapsed)}>
          {store.collapsed ? <ChevronDown className={TM_UI.icon} aria-hidden="true" /> : <ChevronUp className={TM_UI.icon} aria-hidden="true" />}
        </button>
        <button type="button" className={TM_UI.iconButton} aria-label="关闭 Debug 模式" title="关闭 Debug 模式" onClick={() => store.setEnabled(false)}>
          <X className={TM_UI.icon} aria-hidden="true" />
        </button>
      </div>

      {!store.collapsed && (
        <>
          <div
            className="flex flex-wrap items-center gap-1 px-2 py-1 shrink-0"
            style={{ borderBottom: '1px solid var(--color-border-subtle)', pointerEvents: 'auto' }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            {DEBUG_HUD_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={store.categories.length === 0 || store.categories.includes(category) ? TM_UI.pillButton : tmUI(TM_UI.pillButton, 'opacity-50')}
                aria-pressed={store.categories.length === 0 || store.categories.includes(category)}
                title={`切换「${CATEGORY_LABEL[category]}」类日志`}
                style={{ fontSize: 'var(--font-size-xs)', color: CATEGORY_COLOR[category] }}
                onClick={() => store.toggleCategory(category)}
              >
                {CATEGORY_LABEL[category]}
              </button>
            ))}
            <span className="mx-0.5" style={{ width: 1, height: 14, background: 'var(--color-border-subtle)' }} />
            {DEBUG_HUD_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={store.levels.length === 0 || store.levels.includes(level) ? TM_UI.pillButton : tmUI(TM_UI.pillButton, 'opacity-50')}
                aria-pressed={store.levels.length === 0 || store.levels.includes(level)}
                title={`切换 ${level} 级别`}
                style={{ fontSize: 'var(--font-size-xs)', color: LEVEL_COLOR[level] }}
                onClick={() => store.toggleLevel(level)}
              >
                {LEVEL_SHORT[level]}
              </button>
            ))}
            <input
              className={tmUI(TM_UI.input, 'flex-1 min-w-[80px]')}
              style={{ height: 22, fontSize: 'var(--font-size-xs)' }}
              value={store.keyword}
              placeholder="筛选关键词"
              aria-label="筛选关键词"
              onChange={(e) => store.setKeyword(e.target.value)}
            />
            <button type="button" className={TM_UI.iconButton} aria-label="复制当前可见日志" title="复制当前可见日志为 JSON" onClick={handleCopy}>
              <Copy className={TM_UI.icon} aria-hidden="true" />
            </button>
            <button type="button" className={TM_UI.iconButton} aria-label="打开完整系统日志" title="打开完整系统日志（回放 / 因果链 / 崩溃分析）" onClick={openMonitor}>
              <ExternalLink className={TM_UI.icon} aria-hidden="true" />
            </button>
          </div>

          <div
            ref={listRef}
            className={tmUI('flex-1 min-h-0 overflow-y-auto', TM_UI.scroll)}
            style={{ pointerEvents: debugHudRootPointerEvents(store.clickThrough) }}
          >
            {visible.length === 0 ? (
              <div className="h-full flex items-center justify-center" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                {summary.total === 0 ? '等待日志…' : '当前过滤条件下没有日志'}
              </div>
            ) : visible.map((entry, index) => {
              const key = entryKey(entry, index)
              const level = debugLevelOf(entry)
              const category = debugCategoryOf(entry)
              const expanded = store.detailed && expandedKey === key
              const background = level === 'ERROR'
                ? 'var(--color-danger-soft)'
                : level === 'WARN'
                  ? 'var(--color-warning-soft, transparent)'
                  : undefined
              return (
                <div key={key} style={{ background }}>
                  <div
                    className="flex items-start gap-1.5 px-2 py-0.5 min-w-0"
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      cursor: store.detailed ? 'pointer' : 'default',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      textShadow: debugHudLogTextShadow(store.translucent, hovered),
                    }}
                    title={`${debugEntryTitle(entry)}${entry.traceId ? ` · trace=${entry.traceId}` : ''}`}
                    onClick={() => { if (store.detailed) setExpandedKey(expanded ? null : key) }}
                  >
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{debugClock(entry.timestamp)}</span>
                    <span className="shrink-0 font-semibold" style={{ color: LEVEL_COLOR[level], width: 26 }}>{LEVEL_SHORT[level] ?? level.slice(0, 3)}</span>
                    <span className="shrink-0" style={{ color: CATEGORY_COLOR[category], width: 28 }}>{CATEGORY_LABEL[category] ?? category.slice(0, 2)}</span>
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-primary)' }}>{debugEntryTitle(entry)}</span>
                    {typeof entry.durationMs === 'number' && (
                      <span className="shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{Math.round(entry.durationMs)}ms</span>
                    )}
                    <span className="shrink-0 font-mono" style={{ color: 'var(--color-text-muted)' }} title={entry.traceId ?? '独立事件'}>{shortTraceId(entry.traceId)}</span>
                  </div>
                  {expanded && (
                    <pre className="m-0 px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', background: 'var(--color-bg-muted)', textShadow: debugHudLogTextShadow(store.translucent, hovered) }}>
                      {debugEntryDetail(entry)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          <div
            className="shrink-0 cursor-nwse-resize"
            style={{ width: 14, height: 14, touchAction: 'none', position: 'absolute', right: 0, bottom: 0, pointerEvents: 'auto' }}
            title="拖动调整窗口大小"
            onPointerDown={(e) => startDrag(e, 'resize')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </>
      )}
    </div>
  )
})
