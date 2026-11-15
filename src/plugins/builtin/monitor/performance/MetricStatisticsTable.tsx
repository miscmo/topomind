import { formatDuration, formatSuccessRate } from '@/shared/observability/performanceMetrics'
import type { MetricStatistics } from '@/shared/observability/performanceStatistics'
import type { PerformanceMetricId } from '@/shared/observability/performanceContract'

const HEAD = 'px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-text-muted)] whitespace-nowrap'
const CELL = 'px-3 py-2 text-[12px] whitespace-nowrap'

export function MetricStatisticsTable({
  stats,
  activeMetric,
  onSelect,
}: {
  stats: MetricStatistics[]
  activeMetric: PerformanceMetricId | null
  onSelect: (id: PerformanceMetricId) => void
}) {
  const withSamples = stats.filter((item) => item.count > 0)
    .sort((a, b) => b.p95Ms - a.p95Ms)
  const idleCount = stats.length - withSamples.length

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">指标统计</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">按 P95 降序，点击一行可切换下方趋势图</div>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">已接入未采样 {idleCount} 项</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="bg-[var(--color-bg-muted)]">
              <th className={HEAD}>指标</th>
              <th className={HEAD}>分类</th>
              <th className={`${HEAD} text-right`}>样本</th>
              <th className={`${HEAD} text-right`}>P50</th>
              <th className={`${HEAD} text-right`}>P95</th>
              <th className={`${HEAD} text-right`}>P99</th>
              <th className={`${HEAD} text-right`}>成功率</th>
              <th className={`${HEAD} text-right`}>慢 / 失败</th>
              <th className={`${HEAD} text-right`}>阈值</th>
            </tr>
          </thead>
          <tbody>
            {withSamples.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[12px] text-[var(--color-text-muted)]">
                  当前筛选条件下没有样本
                </td>
              </tr>
            ) : withSamples.map((item) => {
              const active = item.metric === activeMetric
              const overThreshold = item.p95Ms > item.thresholdMs
              return (
                <tr
                  key={item.metric}
                  onClick={() => onSelect(item.metric)}
                  className="cursor-pointer border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-hover-bg)]"
                  style={{ background: active ? `color-mix(in srgb, ${item.color} 10%, var(--color-surface))` : undefined }}
                >
                  <td className={CELL}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
                      <span className="font-medium text-[var(--color-text-primary)]">{item.label}</span>
                      {overThreshold && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
                          P95 超阈值
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${CELL} text-[var(--color-text-secondary)]`}>{item.categoryLabel}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-primary)]`}>{item.count}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(item.p50Ms)}</td>
                  <td className={`${CELL} text-right font-semibold text-[var(--color-text-primary)]`}>{formatDuration(item.p95Ms)}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(item.p99Ms)}</td>
                  <td className={`${CELL} text-right`} style={{ color: item.failCount > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                    {formatSuccessRate(item.successRate)}
                  </td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{item.slowCount} / {item.failCount}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-muted)]`}>{formatDuration(item.thresholdMs)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
