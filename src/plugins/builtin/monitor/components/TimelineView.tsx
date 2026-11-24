import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ListTree, Network } from 'lucide-react'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import {
  categoryLabel,
  filterViewEntries,
  groupBySession,
  replaySteps,
  type TraceGroup,
} from '@/shared/observability/logViewModel'
import { EmptyState } from '@/shared/ui/EmptyState'
import { CATEGORY_COLORS, LEVEL_COLORS } from '../constants'

/**
 * v3 P4「事件流」：按 session 分组、按 trace 折叠、可回放。
 * 叙事单位是「一次用户操作」，而不是逐条鼠标事件（D2）；原始输入只在
 * 异常视图的 breadcrumbs 里出现。
 */
const TM_UI = {
  card: 'tm-timeline-card border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] mb-2 overflow-hidden',
  head: 'tm-timeline-head flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-hover-bg)] w-full text-left border-none bg-transparent',
  row: 'tm-timeline-row flex items-center gap-2 px-3 py-1 cursor-pointer border-none bg-transparent w-full text-left hover:bg-[var(--color-hover-bg)]',
  jump: 'tm-timeline-jump px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]',
  badge: 'tm-timeline-badge px-1.5 rounded font-semibold',
}

function clock(entry: { timestamp?: string }): string {
  return entry.timestamp?.slice(11, 23) ?? '--:--:--.---'
}

/** 链内阶段标签：让「触发 → 内部 → 耗时 → 结果」读得出来，而不是一串平铺消息。 */
function stageOf(entry: TraceGroup['entries'][number], index: number, total: number): string {
  if (entry.level === 'ERROR' || entry.category === 'error') return '异常'
  if (entry.category === 'user') return '触发'
  if (entry.category === 'performance') return '耗时'
  if (index === total - 1 && entry.result) return '结果'
  return '内部'
}

/** 无 trace 或单条 trace 的事件合并成一块，明确标注「独立事件」而非伪装成操作卡。 */
function IndependentList({ groups, onSelectEntry }: {
  groups: TraceGroup[]
  onSelectEntry: (entry: TraceGroup['entries'][number]) => void
}) {
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const rows = groups.flatMap((group) => group.entries).slice(0, 80)
  if (total === 0) return null
  return (
    <div className={TM_UI.card}>
      <div className="tm-timeline-independent-head flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-muted)]" style={{ fontSize: 'var(--font-size-sm)' }}>
        <ListTree className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        <span className="font-semibold text-[var(--color-text-secondary)]">独立事件</span>
        <span className="text-[var(--color-text-muted)]">{total} 条 · 周期任务 / 主进程 / 聚合审计，无关联链路</span>
        {total > rows.length && (
          <span className="ml-auto text-[var(--color-text-muted)]">仅显示前 {rows.length} 条</span>
        )}
      </div>
      <div className="border-t border-[var(--color-border-subtle)]">
        {rows.map((entry, index) => (
          <button
            key={entry.id ?? `independent-${index}`}
            className={TM_UI.row}
            style={{ fontSize: 'var(--font-size-sm)' }}
            onClick={() => onSelectEntry(entry)}
          >
            <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(entry)}</span>
            <span className="shrink-0 text-[var(--color-text-secondary)]" style={{ width: 48 }}>{categoryLabel(entry.category)}</span>
            <span className="truncate flex-1 text-[var(--color-text-primary)]">{entry.label || entry.message || entry.action}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TraceCard({
  group,
  expanded,
  onToggle,
  detailed,
  replayEntryId,
  onSelectEntry,
  onJumpToSpans,
}: {
  group: TraceGroup
  expanded: boolean
  onToggle: () => void
  detailed: boolean
  replayEntryId?: string
  onSelectEntry: (entry: TraceGroup['entries'][number]) => void
  onJumpToSpans: (traceId: string) => void
}) {
  const root = group.root
  const title = root?.label || root?.message || root?.action || '未命名操作'
  const categories = Object.entries(group.categoryCounts)
  // P7：一次交互只落 1 条记录，过程步骤在内存；仅 error / 诊断包才 dump 出 steps。
  const memorySteps = group.entries.reduce(
    (sum, entry) => sum + (typeof entry.stepCount === 'number' ? entry.stepCount : 0), 0,
  )
  const dumpedSteps = group.entries.flatMap((entry) => (Array.isArray(entry.steps) ? entry.steps : []))
  return (
    <div className={TM_UI.card}>
      <button className={TM_UI.head} onClick={onToggle} style={{ fontSize: 'var(--font-size-md)' }}>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(root ?? {})}</span>
        <span className="font-semibold text-[var(--color-text-primary)] truncate flex-1">{title}</span>
        {group.hasError && <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-danger)] shrink-0" />}
        {group.outcome && (
          <span
            className={TM_UI.badge}
            style={{
              fontSize: 'var(--font-size-xs)',
              color: group.outcome === 'failure' ? 'var(--color-danger)' : 'var(--color-text-muted)',
              background: 'var(--color-bg-muted)',
            }}
          >
            {group.outcome === 'failure' ? '失败' : group.outcome}
          </span>
        )}
        <span className="text-[var(--color-text-muted)] tabular-nums shrink-0">
          {group.entries.length} 条 · {group.durationMs}ms{memorySteps > 0 ? ` · ${memorySteps} 内存步骤` : ''}
        </span>
      </button>
      <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
        {categories.map(([id, count]) => (
          <span
            key={id}
            className={TM_UI.badge}
            style={{ fontSize: 'var(--font-size-xs)', color: CATEGORY_COLORS[id] ?? 'var(--color-text-muted)', background: 'var(--color-bg-muted)' }}
          >
            {categoryLabel(id)} {count}
          </span>
        ))}
        <span className="ml-auto font-mono text-[var(--color-text-muted)] truncate" style={{ fontSize: 'var(--font-size-xs)' }} title={group.traceId}>
          {group.traceId}
        </span>
        <button
          className={TM_UI.jump}
          style={{ fontSize: 'var(--font-size-xs)' }}
          title="在内部链路视图查看该 trace 的 span 瀑布"
          onClick={() => onJumpToSpans(group.traceId)}
        >
          <Network className="h-3 w-3 inline" /> 链路
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)]">
          {group.entries.map((entry, index) => (
            <button
              key={entry.id ?? `${group.traceId}-${index}`}
              className={TM_UI.row}
              style={{
                fontSize: 'var(--font-size-sm)',
                paddingLeft: entry.category === 'user' ? 12 : 26,
                borderLeft: entry.category === 'user'
                  ? '2px solid var(--color-accent)'
                  : '2px solid var(--color-border-subtle)',
                outline: replayEntryId && replayEntryId === entry.id ? '2px solid var(--color-accent)' : undefined,
                background: replayEntryId && replayEntryId === entry.id ? 'var(--color-selected-bg)' : undefined,
              }}
              onClick={() => onSelectEntry(entry)}
            >
              <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(entry)}</span>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS[entry.level ?? 'INFO'] }} />
              <span className="shrink-0 text-[var(--color-text-secondary)]" style={{ width: 48 }}>
                {stageOf(entry, index, group.entries.length)}
              </span>
              <span className="truncate flex-1 text-[var(--color-text-primary)]">{entry.label || entry.message || entry.action}</span>
              {detailed && entry.target && (
                <span className="font-mono text-[var(--color-text-muted)] shrink-0" style={{ fontSize: 'var(--font-size-xs)' }}>
                  {entry.target.type}:{entry.target.id ?? '—'}
                </span>
              )}
              {typeof entry.durationMs === 'number' && (
                <span className="tabular-nums text-[var(--color-text-muted)] shrink-0">{entry.durationMs}ms</span>
              )}
              {entry.result && (
                <span className="text-[var(--color-text-muted)] shrink-0">{entry.result}</span>
              )}
            </button>
          ))}
          {memorySteps > 0 && (
            <div className="tm-timeline-steps flex items-center gap-2 px-3 py-1.5 text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>
              <ListTree className="h-3 w-3 shrink-0" />
              <span>
                过程步骤 {memorySteps} 条留在内存（P7 事实唯一性）：
                {dumpedSteps.length > 0
                  ? `本次因异常 / 诊断包已 dump ${dumpedSteps.length} 条`
                  : '平时不落盘'}
              </span>
            </div>
          )}
          {dumpedSteps.length > 0 && (
            <div className="border-t border-[var(--color-border-subtle)]">
              {dumpedSteps.slice(0, 50).map((step, index) => (
                <div
                  key={`${step.name}-${index}`}
                  className={TM_UI.row}
                  style={{ fontSize: 'var(--font-size-xs)', paddingLeft: 26, cursor: 'default' }}
                >
                  <span className="font-mono text-[var(--color-text-muted)] shrink-0">
                    {new Date(step.at).toISOString().slice(11, 23)}
                  </span>
                  <span className="shrink-0 text-[var(--color-text-secondary)]">{step.outcome ?? '步骤'}</span>
                  <span className="truncate flex-1 font-mono text-[var(--color-text-primary)]">{step.name}</span>
                  {typeof step.durationMs === 'number' && (
                    <span className="tabular-nums text-[var(--color-text-muted)] shrink-0">{step.durationMs}ms</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TimelineView() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedCategories = useMonitorStore((s) => s.selectedCategories)
  const selectedSessionId = useMonitorStore((s) => s.selectedSessionId)
  const selectedTraceId = useMonitorStore((s) => s.selectedTraceId)
  const displaySampleRate = useMonitorStore((s) => s.displaySampleRate)
  const detailed = useMonitorStore((s) => s.detailed)
  const replayCursor = useMonitorStore((s) => s.replayCursor)
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const setSelectedTraceId = useMonitorStore((s) => s.setSelectedTraceId)
  const setActiveTab = useMonitorStore((s) => s.setActiveTab)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const filters = useMemo(() => ({
    keyword,
    levels: selectedLevels,
    categories: selectedCategories,
    sessionId: selectedSessionId,
    traceId: selectedTraceId,
    displaySampleRate,
  }), [keyword, selectedLevels, selectedCategories, selectedSessionId, selectedTraceId, displaySampleRate])

  const sessions = useMemo(() => groupBySession(filterViewEntries(entries, filters)), [entries, filters])
  const steps = useMemo(() => replaySteps(entries, filters), [entries, filters])
  const replayEntry = replayCursor === null ? null : steps[replayCursor]
  const chainCount = sessions.reduce((sum, s) => sum + s.traces.filter((t) => t.isChain).length, 0)
  const independentCount = sessions.reduce((sum, s) => sum + s.traces.filter((t) => !t.isChain).length, 0)

  const selectEntry = (entry: TraceGroup['entries'][number]) => {
    setSelectedEntry(entry)
    setSelectedTraceId(entry.traceId ?? null)
  }

  const toggle = (traceId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(traceId)) next.delete(traceId)
      else next.add(traceId)
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-app)]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] shrink-0" style={{ fontSize: 'var(--font-size-sm)' }}>
        <ListTree className="h-3.5 w-3.5 text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-text-primary)]">事件流</span>
        <span className="text-[var(--color-text-muted)]">按 session 分组 · 共 {sessions.length} 会话 / {chainCount} 操作链 / {independentCount} 独立事件</span>
        {replayEntry && (
          <span className="ml-auto text-[var(--color-accent)] truncate" title={replayEntry.label}>
            回放：{replayEntry.label || replayEntry.message}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {sessions.length === 0 ? (
          <EmptyState size="md" icon={<ListTree className="h-6 w-6" />} title="暂无可回放的事件" />
        ) : (
          sessions.map((session) => {
            const chains = session.traces.filter((group) => group.isChain)
            const independents = session.traces.filter((group) => !group.isChain)
            return (
              <section key={session.sessionId} className="mb-4">
                <div className="flex items-center gap-2 mb-2 px-1 text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>
                  <span className="font-mono font-semibold text-[var(--color-text-secondary)]">{session.sessionId}</span>
                  <span>{session.entryCount} 条 · {chains.length} 次操作 · {independents.length} 条独立事件</span>
                  <span>{clock({ timestamp: new Date(session.startedAt).toISOString() })} → {clock({ timestamp: new Date(session.endedAt).toISOString() })}</span>
                </div>
                {chains.map((group) => (
                  <TraceCard
                    key={group.traceId}
                    group={group}
                    expanded={!collapsed.has(group.traceId)}
                    onToggle={() => toggle(group.traceId)}
                    detailed={detailed}
                    replayEntryId={replayEntry?.id}
                    onSelectEntry={selectEntry}
                    onJumpToSpans={(traceId) => {
                      setSelectedTraceId(traceId)
                      setActiveTab('spans')
                    }}
                  />
                ))}
                <IndependentList groups={independents} onSelectEntry={selectEntry} />
              </section>
            )
          })
        )}
      </div>
      {selectedEntry && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-2 bg-[var(--color-surface)] shrink-0" style={{ fontSize: 'var(--font-size-sm)' }}>
          <span className="text-[var(--color-text-muted)]">已选：</span>
          <span className="text-[var(--color-text-primary)]">{selectedEntry.label || selectedEntry.message}</span>
          <span className="ml-2 font-mono text-[var(--color-text-muted)]">{selectedEntry.traceId ?? '无 trace'}</span>
          <button
            className={`${TM_UI.jump} ml-2`}
            style={{ fontSize: 'var(--font-size-xs)' }}
            onClick={() => setActiveTab('log')}
          >
            在原始日志中查看详情
          </button>
        </div>
      )}
    </div>
  )
}
