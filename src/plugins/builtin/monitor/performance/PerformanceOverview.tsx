import { PERFORMANCE_CATEGORIES } from '@/shared/observability/performanceContract'
import {
  formatDuration,
  formatSuccessRate,
} from '@/shared/observability/performanceMetrics'
import type {
  CategoryStatistics,
  OperationStatistics,
  PerformanceOverview,
  TrendComparison,
} from '@/shared/observability/performanceStatistics'

const CARD = 'min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-sm)]'

function HeroCard({ title, value, hint, accent }: { title: string; value: string; hint: string; accent: string }) {
  return (
    <div className={CARD}>
      <div className="text-[11px] font-semibold text-[var(--color-text-muted)]">{title}</div>
      <div className="mt-2 text-[26px] font-bold leading-none" style={{ color: accent }}>{value}</div>
      <div className="mt-2 truncate text-[12px] text-[var(--color-text-secondary)]" title={hint}>{hint}</div>
    </div>
  )
}

function trendText(trend: TrendComparison): string {
  if (trend.direction === 'flat') return '前后半段 P95 基本持平'
  const arrow = trend.direction === 'up' ? '上升' : '下降'
  return `较前半段 ${arrow} ${Math.abs(trend.deltaPercent).toFixed(0)}%`
}

export function PerformanceOverview({
  overview,
  categories,
  trend,
  sensitiveOperations,
}: {
  overview: PerformanceOverview
  categories: CategoryStatistics[]
  trend: TrendComparison
  sensitiveOperations: OperationStatistics[]
}) {
  const maxCategoryCount = Math.max(1, ...categories.map((item) => item.count))
  // 已按 P95 降序；只取被判定为「随规模劣化」的前 3 个动作。
  const sensitive = sensitiveOperations.filter((item) => item.scaleSensitive).slice(0, 3)
  return (
    <div className="mt-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HeroCard
          title="性能样本"
          value={String(overview.total)}
          hint={`覆盖 ${overview.activeMetricCount}/${overview.coveredMetricCount} 项指标 · ${overview.sessionCount} 个会话`}
          accent="var(--color-accent)"
        />
        <HeroCard
          title="总体成功率"
          value={formatSuccessRate(overview.successRate)}
          hint={`失败 ${overview.failCount} 条 · 失败样本不计入慢操作`}
          accent="var(--color-success)"
        />
        <HeroCard
          title="P95 耗时"
          value={formatDuration(overview.p95Ms)}
          hint={trendText(trend)}
          accent="var(--color-primary)"
        />
        <HeroCard
          title="慢操作"
          value={String(overview.slowCount)}
          hint={`占比 ${formatSuccessRate(overview.slowRate)} · 超过各指标阈值`}
          accent="var(--color-warning)"
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {categories.map((item) => (
          <div key={item.category} className={`${CARD} py-2.5`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] font-medium" style={{ color: PERFORMANCE_CATEGORIES[item.category].color }}>
                {item.label}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">{item.count} 条</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(item.count / maxCategoryCount) * 100}%`,
                  background: PERFORMANCE_CATEGORIES[item.category].color,
                }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
              P95 {formatDuration(item.p95Ms)} · 失败 {item.failCount} · 慢 {item.slowCount}
            </div>
          </div>
        ))}
      </div>

      {sensitive.length > 0 && (
        <div className={`${CARD} mt-3 py-2.5`}>
          <div className="text-[11px] font-semibold text-[var(--color-text-muted)]">
            规模敏感动作 Top3 · 相邻规模桶 P95 涨幅 ≥50%
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {sensitive.map((item) => (
              <div
                key={item.operation}
                className="flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px]"
              >
                <span className="font-medium text-[var(--color-text-primary)]">{item.label}</span>
                <span className="text-[var(--color-text-secondary)]">P95 {formatDuration(item.p95Ms)}</span>
                <span className="text-[var(--color-text-muted)]">{item.count} 条 · 每节点 {item.avgPerUnitMs.toFixed(1)} ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
