/**
 * 慢操作链路瀑布：同一次用户操作的主样本 + 全量构建 / 写盘子样本按时间排开。
 * 选中态是纯派生，不写 effect；点击 traceId 可以把慢样本面板与这里联动。
 */
import { formatCompactDateTime, formatDuration } from '@/shared/observability/performanceMetrics'
import type { TraceGroup } from '@/shared/observability/performanceStatistics'

interface TraceWaterfallPanelProps {
  groups: TraceGroup[]
  selectedTraceId: string | null
  onSelect: (traceId: string | null) => void
}

function shortTraceId(traceId: string): string {
  return traceId.length > 18 ? `${traceId.slice(0, 8)}…${traceId.slice(-6)}` : traceId
}

export function TraceWaterfallPanel({ groups, selectedTraceId, onSelect }: TraceWaterfallPanelProps) {
  const listed = groups.slice(0, 8)
  const resolved = groups.find((group) => group.traceId === selectedTraceId)
    ?? groups.find((group) => group.slow)
    ?? groups[0]
    ?? null
  const scale = resolved ? Math.max(resolved.totalMs, 1) : 1

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">慢操作链路</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            同一次操作按 traceId 串联；后台构建与写盘按房间 + 时间窗归并
          </div>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">{groups.length} 条链路</div>
      </div>

      {listed.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-[var(--color-text-muted)]">
          暂无画布操作链路；新建 / 删除 / 移动 / 缩放节点后会自动出现
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {listed.map((group) => {
              const active = resolved?.traceId === group.traceId
              return (
                <button
                  key={group.traceId}
                  type="button"
                  onClick={() => onSelect(group.traceId)}
                  className="rounded-md border px-2 py-1 text-[11px]"
                  style={{
                    borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                    background: active
                      ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))'
                      : 'var(--color-surface)',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  }}
                  title={group.traceId}
                >
                  {formatCompactDateTime(new Date(group.startMs).toISOString())}
                  {' · '}{formatDuration(group.totalMs)}
                  {group.slow ? ' · 慢' : ''}
                </button>
              )
            })}
          </div>

          {resolved && (
            <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                <span className="font-mono">{shortTraceId(resolved.traceId)}</span>
                {resolved.contextKey && <span>· {resolved.contextKey}</span>}
                <span>· {resolved.spans.length} 段 · 合计 {formatDuration(resolved.totalMs)}</span>
              </div>
              <div className="space-y-1.5">
                {resolved.spans.map((span) => {
                  const left = Math.min(100, (span.offsetMs / scale) * 100)
                  const width = Math.min(100 - left, (span.durationMs / scale) * 100)
                  const tone = !span.success
                    ? 'var(--color-danger)'
                    : span.metric === 'graph_meta_build' || span.metric === 'graph_meta_flush'
                      ? 'var(--color-warning)'
                      : 'var(--color-accent)'
                  return (
                    <div key={span.id} className="flex items-center gap-2">
                      <div className="w-[150px] shrink-0 truncate text-[11px] text-[var(--color-text-secondary)]" title={span.label}>
                        {span.label}
                        {span.operation ? ` · ${span.operation}` : ''}
                      </div>
                      <div className="relative h-[14px] flex-1 rounded-sm" style={{ background: 'var(--color-bg-muted)' }}>
                        <div
                          className="absolute inset-y-0 rounded-sm"
                          style={{
                            left: `${left}%`,
                            width: `max(2px, ${width}%)`,
                            background: `color-mix(in srgb, ${tone} 30%, var(--color-surface))`,
                            border: `0.5px solid ${tone}`,
                          }}
                        />
                      </div>
                      <div className="w-[76px] shrink-0 text-right text-[11px] text-[var(--color-text-primary)]">
                        {formatDuration(span.durationMs)}
                      </div>
                    </div>
                  )
                })}
              </div>
              {resolved.spans.some((span) => span.scaleLabel) && (
                <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                  规模：{resolved.spans.find((span) => span.scaleLabel)?.scaleLabel}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
