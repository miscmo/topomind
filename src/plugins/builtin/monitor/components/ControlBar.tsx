import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import { listSessionIds, replaySteps } from '@/shared/observability/logViewModel'
import { LEVELS } from '../constants'
import { useMonitorHost } from '../hostContext'

/**
 * v3 P4 统一控制条：把 P0 临时塞在 FilterBar 的等级阈值、实时流上移，
 * 与 session / 详细模式 / 显示采样 / 回放共用一个全局控制面。
 *
 * 诚实边界：
 * - 「显示采样」只降采样 internal/performance 的 UI 展示，不改采集；
 *   采集采样由事件目录 sampleRate 决定，运行时不可调（方案 §9）。
 * - 「详细模式」只增加展开密度，不改变落盘脱敏口径（D3）。
 * - session 选择只影响视图，点「刷新」时才下推到主进程 query。
 */
const TM_UI = {
  bar: 'tm-controlbar flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] flex-wrap shrink-0',
  label: 'tm-control-label flex items-center gap-1 text-[var(--color-text-muted)] whitespace-nowrap',
  select: 'tm-control-select h-6 px-1.5 border border-[var(--color-border)] rounded outline-none bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-primary)] focus:border-[var(--color-accent)]',
  toggle: 'tm-control-toggle flex items-center gap-1 cursor-pointer text-[var(--color-text-muted)] select-none [&>input]:accent-[var(--color-primary)] whitespace-nowrap',
  button: 'tm-control-button h-6 px-2 border border-[var(--color-border)] rounded bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] disabled:opacity-50',
}

type LevelValue = (typeof LEVELS)[number]

export function ControlBar() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedCategories = useMonitorStore((s) => s.selectedCategories)
  const selectedSessionId = useMonitorStore((s) => s.selectedSessionId)
  const selectedTraceId = useMonitorStore((s) => s.selectedTraceId)
  const streaming = useMonitorStore((s) => s.streaming)
  const detailed = useMonitorStore((s) => s.detailed)
  const displaySampleRate = useMonitorStore((s) => s.displaySampleRate)
  const replayCursor = useMonitorStore((s) => s.replayCursor)
  const activeTab = useMonitorStore((s) => s.activeTab)
  const setStreaming = useMonitorStore((s) => s.setStreaming)
  const setDetailed = useMonitorStore((s) => s.setDetailed)
  const setDisplaySampleRate = useMonitorStore((s) => s.setDisplaySampleRate)
  const setSelectedSessionId = useMonitorStore((s) => s.setSelectedSessionId)
  const setSelectedTraceId = useMonitorStore((s) => s.setSelectedTraceId)
  const setReplayCursor = useMonitorStore((s) => s.setReplayCursor)
  const { logs, log } = useMonitorHost()

  const [runtimeLevel, setRuntimeLevel] = useState<LevelValue | null>(null)
  useEffect(() => {
    let alive = true
    const pending = logs.getLevel?.()
    if (pending) void pending.then((level) => { if (alive) setRuntimeLevel(level as LevelValue) }).catch(() => {})
    const subscription = logs.subscribeLevel?.((level) => setRuntimeLevel(level as LevelValue))
    return () => {
      alive = false
      subscription?.dispose()
    }
  }, [logs])

  const sessions = useMemo(() => listSessionIds(entries), [entries])
  const steps = useMemo(() => replaySteps(entries, {
    keyword,
    levels: selectedLevels,
    categories: selectedCategories,
    sessionId: selectedSessionId,
  }), [entries, keyword, selectedLevels, selectedCategories, selectedSessionId])
  const replaying = replayCursor !== null

  const moveReplay = useCallback((delta: number) => {
    const next = Math.min(Math.max((replayCursor ?? 0) + delta, 0), Math.max(0, steps.length - 1))
    setReplayCursor(next)
    const entry = steps[next]
    if (entry) useMonitorStore.setState({ selectedEntry: entry, selectedTraceId: entry.traceId ?? null })
  }, [replayCursor, setReplayCursor, steps])

  return (
    <div className={TM_UI.bar} style={{ fontSize: 'var(--font-size-sm)' }}>
      <span className="font-semibold text-[var(--color-text-secondary)] tracking-[0.3px]">可观测性</span>

      {logs.setLevel && (
        <label className={TM_UI.label} title="日志等级阈值：主进程唯一真源，切换后所有窗口同步；DEBUG 只进内存不落盘">
          阈值
          <select
            className={TM_UI.select}
            value={runtimeLevel ?? 'INFO'}
            onChange={(e) => {
              const next = e.target.value as LevelValue
              const result = logs.setLevel?.(next)
              if (result) void result.then(setRuntimeLevel).catch(() => {})
              log.info('monitor log level changed', { level: next })
            }}
          >
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      )}

      <label className={TM_UI.label} title="按会话回放；切换工作目录后仍按 session 组织叙事（D5）">
        会话
        <select
          className={TM_UI.select}
          value={selectedSessionId ?? ''}
          onChange={(e) => {
            const next = e.target.value || null
            setSelectedSessionId(next)
            log.info('monitor session selected', { sessionId: next ?? 'all' })
          }}
        >
          <option value="">全部会话（{sessions.length}）</option>
          {sessions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>

      <label className={TM_UI.label} title="仅影响 UI 展示密度：internal / performance 按步长抽样，user / error 始终全量">
        显示采样
        <select
          className={TM_UI.select}
          value={displaySampleRate}
          onChange={(e) => {
            const next = Number(e.target.value) as 1 | 0.5 | 0.1
            setDisplaySampleRate(next)
            log.info('monitor display sample changed', { displaySampleRate: next })
          }}
        >
          <option value={1}>100%</option>
          <option value={0.5}>50%</option>
          <option value={0.1}>10%</option>
        </select>
      </label>

      <label className={TM_UI.toggle} title="详细模式：展开更多字段，不改变已落盘的脱敏内容">
        <input
          type="checkbox"
          checked={detailed}
          onChange={(e) => setDetailed(e.target.checked)}
        />
        <span>详细</span>
      </label>

      <label className={TM_UI.toggle} title="实时订阅主进程 log:entry 广播">
        <input
          type="checkbox"
          checked={streaming}
          onChange={(e) => {
            setStreaming(e.target.checked)
            log.info('monitor streaming toggled', { newStreaming: e.target.checked })
          }}
        />
        <span>实时</span>
      </label>

      {activeTab === 'timeline' && (
        <div className="flex items-center gap-1">
          <button
            className={TM_UI.button}
            title={replaying ? '退出回放' : '按时间顺序回放当前筛选结果'}
            onClick={() => {
              if (replaying) setReplayCursor(null)
              else { setReplayCursor(0); log.info('monitor replay started', { steps: steps.length }) }
            }}
          >
            {replaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <button className={TM_UI.button} title="上一步" disabled={!replaying} onClick={() => moveReplay(-1)}>
            <StepBack className="h-3 w-3" />
          </button>
          <button className={TM_UI.button} title="下一步" disabled={!replaying} onClick={() => moveReplay(1)}>
            <StepForward className="h-3 w-3" />
          </button>
          {replaying && <span className="text-[var(--color-text-muted)] tabular-nums">{replayCursor + 1}/{steps.length}</span>}
        </div>
      )}

      {selectedTraceId && (
        <button
          className={`${TM_UI.button} flex items-center gap-1`}
          title="清除 trace 联动过滤"
          onClick={() => { setSelectedTraceId(null); setReplayCursor(null) }}
        >
          <RotateCcw className="h-3 w-3" />
          <span>trace {selectedTraceId.slice(-8)}</span>
        </button>
      )}

      <span className="ml-auto text-[var(--color-text-muted)] tabular-nums" title="缓冲条目数 / 当前筛选可回放步骤数">
        {entries.length} 条 · {steps.length} 步
      </span>
    </div>
  )
}
