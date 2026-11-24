import { useMemo } from 'react'
import { ArrowLeft, Network } from 'lucide-react'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import {
  buildSpanTree,
  categoryLabel,
  filterViewEntries,
  flattenSpanTree,
  groupByTrace,
  userEventForTrace,
} from '@/shared/observability/logViewModel'
import { EmptyState } from '@/shared/ui/EmptyState'
import { CATEGORY_COLORS, LEVEL_COLORS } from '../constants'

/**
 * v3 P4「内部链路」：按 parentId → spanId 建树，渲染耗时瀑布。
 * 与事件流双向联动：从事件流带 traceId 跳进来，或在这里跳回事件流。
 */
const TM_UI = {
  traceRow: 'tm-span-trace flex items-center gap-2 px-3 py-1.5 w-full text-left border-none bg-transparent cursor-pointer hover:bg-[var(--color-hover-bg)]',
  jump: 'tm-span-jump px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]',
}

function clock(entry: { timestamp?: string }): string {
  return entry.timestamp?.slice(11, 23) ?? '--:--:--.---'
}

export function SpanView() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedCategories = useMonitorStore((s) => s.selectedCategories)
  const selectedSessionId = useMonitorStore((s) => s.selectedSessionId)
  const selectedTraceId = useMonitorStore((s) => s.selectedTraceId)
  const detailed = useMonitorStore((s) => s.detailed)
  const setSelectedTraceId = useMonitorStore((s) => s.setSelectedTraceId)
  const focusTrace = useMonitorStore((s) => s.focusTrace)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)

  const scoped = useMemo(() => filterViewEntries(entries, {
    keyword,
    levels: selectedLevels,
    categories: selectedCategories,
    sessionId: selectedSessionId,
  }), [entries, keyword, selectedLevels, selectedCategories, selectedSessionId])

  const traces = useMemo(() => groupByTrace(scoped).slice(-30).reverse(), [scoped])
  const traceEntries = useMemo(
    () => selectedTraceId ? scoped.filter((e) => e.traceId === selectedTraceId) : [],
    [scoped, selectedTraceId],
  )
  const nodes = useMemo(() => flattenSpanTree(buildSpanTree(traceEntries)), [traceEntries])
  const maxDuration = useMemo(
    () => Math.max(1, ...nodes.map((n) => n.durationMs || 0)),
    [nodes],
  )
  const rootUser = selectedTraceId ? userEventForTrace(entries, selectedTraceId) : null

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-app)]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] shrink-0" style={{ fontSize: 'var(--font-size-sm)' }}>
        <Network className="h-3.5 w-3.5 text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-text-primary)]">内部链路</span>
        <span className="text-[var(--color-text-muted)]">span 瀑布 · parentId 缩进 · 耗时条</span>
        {selectedTraceId && (
          <button className={`${TM_UI.jump} ml-auto flex items-center gap-1`} style={{ fontSize: 'var(--font-size-xs)' }} onClick={() => setSelectedTraceId(null)}>
            <ArrowLeft className="h-3 w-3" /> 全部链路
          </button>
        )}
      </div>

      {!selectedTraceId ? (
        <div className="flex-1 overflow-y-auto p-3">
          {traces.length === 0 ? (
            <EmptyState size="md" icon={<Network className="h-6 w-6" />} title="暂无可分析的操作链" />
          ) : (
            <div className="border border-[var(--color-border-subtle)] rounded-md overflow-hidden bg-[var(--color-surface)]">
              {traces.map((trace) => (
                <button
                  key={trace.traceId}
                  className={TM_UI.traceRow}
                  style={{ fontSize: 'var(--font-size-sm)' }}
                  onClick={() => setSelectedTraceId(trace.traceId)}
                >
                  <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(trace.root ?? {})}</span>
                  <span className="flex-1 truncate text-[var(--color-text-primary)]">{trace.root?.label || trace.root?.message || trace.traceId}</span>
                  {trace.hasError && <span className="text-[var(--color-danger)]">异常</span>}
                  <span className="text-[var(--color-text-muted)] tabular-nums">{trace.entries.length} span · {trace.durationMs}ms</span>
                  <span className="font-mono text-[var(--color-text-muted)] shrink-0">{trace.traceId.slice(-8)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] p-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-md)' }}>
                {rootUser?.label || rootUser?.message || '该链路没有 user 事件'}
              </span>
              <span className="font-mono text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>{selectedTraceId}</span>
              <button
                className={`${TM_UI.jump} ml-auto`}
                style={{ fontSize: 'var(--font-size-xs)' }}
                onClick={() => focusTrace(selectedTraceId)}
              >
                在事件流中回放
              </button>
            </div>
            <div className="mt-1 text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>
              {traceEntries.length} 个 span · 最大耗时 {maxDuration}ms · 点击行可在原始日志查看详情
            </div>
          </div>

          {nodes.length === 0 ? (
            <EmptyState size="md" icon={<Network className="h-6 w-6" />} title="该 trace 暂无 span 明细" />
          ) : (
            <div className="border border-[var(--color-border-subtle)] rounded-md overflow-hidden bg-[var(--color-surface)]">
              {nodes.map((node, index) => {
                const entry = node.entry
                const pct = Math.max(2, Math.min(100, Math.round(((node.durationMs || 0) / maxDuration) * 100)))
                return (
                  <button
                    key={entry.id ?? `${selectedTraceId}-${index}`}
                    className={TM_UI.traceRow}
                    style={{ fontSize: 'var(--font-size-sm)', paddingLeft: 10 + node.depth * 18 }}
                    onClick={() => { setSelectedEntry(entry); useMonitorStore.setState({ activeTab: 'log' }) }}
                  >
                    <span className="text-[var(--color-text-muted)] shrink-0">{node.depth > 0 ? '└' : '●'}</span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS[entry.level ?? 'INFO'] }} />
                    <span className="shrink-0 text-[var(--color-text-secondary)]" style={{ width: 52, color: CATEGORY_COLORS[entry.category ?? ''] ?? undefined }}>
                      {categoryLabel(entry.category)}
                    </span>
                    <span className="truncate flex-1 text-[var(--color-text-primary)]">{entry.label || entry.message || entry.action}</span>
                    {detailed && (
                      <span className="font-mono text-[var(--color-text-muted)] shrink-0" style={{ fontSize: 'var(--font-size-xs)' }}>
                        {entry.spanId?.slice(-8) ?? '—'} {entry.parentId ? `← ${entry.parentId.slice(-8)}` : ''}
                      </span>
                    )}
                    <span className="shrink-0" style={{ width: 90 }}>
                      <span className="block h-1.5 rounded-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="tabular-nums text-[var(--color-text-muted)] shrink-0" style={{ width: 56, textAlign: 'right' }}>
                      {node.durationMs || 0}ms
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
