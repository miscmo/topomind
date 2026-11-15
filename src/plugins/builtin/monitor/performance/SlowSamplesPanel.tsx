import { formatCompactDateTime, formatDuration } from '@/shared/observability/performanceMetrics'
import {
  formatSampleContext,
  isSlowSample,
  rankSlowSamples,
} from '@/shared/observability/performanceStatistics'
import type { PerformanceSample } from '@/shared/observability/performanceMetrics'
import { EmptyState } from '@/shared/ui/EmptyState'

const HEAD = 'px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-text-muted)] whitespace-nowrap'
const CELL = 'px-3 py-2 text-[12px]'

interface SlowSamplesPanelProps {
  samples: PerformanceSample[]
  limit?: number
  selectedTraceId?: string | null
  onSelectTrace?: (traceId: string) => void
}

export function SlowSamplesPanel({
  samples, limit = 10, selectedTraceId, onSelectTrace,
}: SlowSamplesPanelProps) {
  const slowest = rankSlowSamples(samples, limit)

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">最慢样本</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">按耗时排序，含失败样本与触发该操作的上下文；生效阈值是埋点按规模放宽后实际判慢的值</div>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">Top {limit}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="bg-[var(--color-bg-muted)]">
              <th className={HEAD}>时间</th>
              <th className={HEAD}>指标</th>
              <th className={`${HEAD} text-right`}>耗时</th>
              <th className={`${HEAD} text-right`}>生效阈值</th>
              <th className={HEAD}>状态</th>
              <th className={HEAD}>上下文</th>
              <th className={HEAD}>来源</th>
              <th className={HEAD}>链路</th>
            </tr>
          </thead>
          <tbody>
            {slowest.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center"><EmptyState size="sm" title="暂无样本" /></td></tr>
            ) : slowest.map((sample) => {
              const status = !sample.success
                ? { label: '失败', color: 'var(--color-danger)' }
                : isSlowSample(sample)
                  ? { label: '慢操作', color: 'var(--color-warning)' }
                  : { label: '正常', color: 'var(--color-success)' }
              const context = formatSampleContext(sample)
              const thresholdRatio = sample.thresholdMs > 0 ? sample.durationMs / sample.thresholdMs : 0
              return (
                <tr key={sample.id} className="border-t border-[var(--color-border-subtle)]">
                  <td className={`${CELL} font-mono text-[11px] text-[var(--color-text-muted)]`}>
                    {formatCompactDateTime(sample.timestamp)}
                  </td>
                  <td className={`${CELL} font-medium`} style={{ color: sample.color }}>{sample.label}</td>
                  <td className={`${CELL} text-right font-semibold text-[var(--color-text-primary)]`}>
                    {formatDuration(sample.durationMs)}
                  </td>
                  <td className={`${CELL} text-right`}>
                    <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {formatDuration(sample.thresholdMs)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {sample.success
                        ? (thresholdRatio > 1 ? `超阈 ${thresholdRatio.toFixed(1)}×` : `阈值内 ${Math.round(thresholdRatio * 100)}%`)
                        : '失败不判慢'}
                    </div>
                  </td>
                  <td className={CELL}>
                    <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 12%, transparent)` }}>
                      {status.label}
                    </span>
                  </td>
                  <td className={`${CELL} max-w-[280px] truncate text-[var(--color-text-secondary)]`} title={context}>{context}</td>
                  <td className={`${CELL} text-[var(--color-text-muted)]`}>{sample.source || sample.module || '—'}</td>
                  <td className={CELL}>
                    {sample.traceId ? (
                      <button
                        type="button"
                        onClick={() => onSelectTrace?.(sample.traceId as string)}
                        className="rounded-md border px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          borderColor: selectedTraceId === sample.traceId
                            ? 'var(--color-accent)'
                            : 'var(--color-border)',
                          color: selectedTraceId === sample.traceId
                            ? 'var(--color-accent)'
                            : 'var(--color-text-secondary)',
                          background: 'var(--color-surface)',
                        }}
                        title={sample.traceId}
                      >
                        {sample.traceId.slice(-6)}
                      </button>
                    ) : (
                      <span className="text-[11px] text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
