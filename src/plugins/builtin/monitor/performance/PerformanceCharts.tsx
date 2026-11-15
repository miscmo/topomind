import {
  formatCompactDateTime,
  formatDuration,
} from '@/shared/observability/performanceMetrics'
import type {
  MetricStatistics,
  TimeBucket,
} from '@/shared/observability/performanceStatistics'
import type { PerformanceSample } from '@/shared/observability/performanceMetrics'
import { EmptyState } from '@/shared/ui/EmptyState'

const PANEL = 'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)]'

function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</div>
      <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">{hint}</div>
    </div>
  )
}

/** 各指标 P50 / P95 双柱，用于横向比较尾延迟。 */
export function DistributionChart({ stats }: { stats: MetricStatistics[] }) {
  const visible = stats.filter((item) => item.count > 0)
  if (visible.length === 0) {
    return <div className={PANEL}><PanelTitle title="P50 / P95 分布" hint="当前筛选下暂无样本" /><EmptyState size="sm" className="h-[180px]" title="暂无分布数据" /></div>
  }
  const maxValue = Math.max(...visible.flatMap((item) => [item.p50Ms, item.p95Ms]), 1)
  const slotWidth = 100 / visible.length
  const barWidth = Math.min(9, slotWidth * 0.26)

  return (
    <div className={PANEL}>
      <PanelTitle title="P50 / P95 分布" hint="用于快速识别尾延迟最高的链路" />
      <svg viewBox="0 0 100 78" className="mt-4 h-[190px] w-full" role="img" aria-label="各指标 P50 与 P95 对比">
        <line x1="6" y1="64" x2="96" y2="64" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        {visible.map((item, index) => {
          const center = slotWidth * index + slotWidth / 2
          const p50Height = (item.p50Ms / maxValue) * 44
          const p95Height = (item.p95Ms / maxValue) * 44
          return (
            <g key={item.metric}>
              <rect
                x={center - barWidth - 1} y={64 - p50Height} width={barWidth} height={p50Height} rx="1.5"
                style={{ fill: `color-mix(in srgb, ${item.color} 55%, transparent)` }}
              />
              <rect
                x={center + 1} y={64 - p95Height} width={barWidth} height={p95Height} rx="1.5"
                style={{ fill: item.color }}
              />
              <text x={center} y="70" textAnchor="middle" fontSize="3.4" style={{ fill: 'var(--color-text-secondary)' }}>
                {item.shortLabel}
              </text>
            </g>
          )
        })}
        <text x="2" y="22" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>{formatDuration(maxValue)}</text>
        <text x="2" y="66" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>0</text>
      </svg>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-accent) 55%, transparent)' }} /> P50
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-accent)' }} /> P95
        </span>
      </div>
    </div>
  )
}

/** 时间分桶：柱=样本量，折线=该桶 P95，空桶保留以暴露操作空档。 */
export function TimeBucketChart({ buckets }: { buckets: TimeBucket[] }) {
  if (buckets.length === 0) {
    return <div className={PANEL}><PanelTitle title="时间分布" hint="按样本跨度等分为 24 个桶" /><EmptyState size="sm" className="h-[180px]" title="暂无时间分布" /></div>
  }
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const maxP95 = Math.max(1, ...buckets.map((bucket) => bucket.p95Ms))
  const slot = 90 / buckets.length
  const points = buckets.map((bucket, index) => ({
    x: 8 + slot * index + slot / 2,
    y: 64 - (bucket.p95Ms / maxP95) * 46,
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const first = formatCompactDateTime(new Date(buckets[0].startMs).toISOString())
  const last = formatCompactDateTime(new Date(buckets[buckets.length - 1].endMs).toISOString())

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelTitle title="时间分布" hint="柱为样本量，折线为该时段 P95；空桶表示这段没有操作" />
        <div className="text-[11px] text-[var(--color-text-muted)]">{first} - {last}</div>
      </div>
      <svg viewBox="0 0 100 78" className="mt-4 h-[190px] w-full" role="img" aria-label="样本量与 P95 的时间分布">
        <line x1="8" y1="64" x2="98" y2="64" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        {buckets.map((bucket, index) => {
          const height = (bucket.count / maxCount) * 46
          return (
            <rect
              key={bucket.startMs}
              x={8 + slot * index + slot * 0.15} y={64 - height}
              width={slot * 0.7} height={height} rx="0.8"
              style={{ fill: 'var(--color-accent)', opacity: bucket.count === 0 ? 0 : 0.28 }}
            />
          )
        })}
        <polyline
          fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" points={line}
          style={{ stroke: 'var(--color-warning)' }}
        />
        {points.map((point, index) => (
          buckets[index].failCount > 0 && (
            <circle key={buckets[index].startMs} cx={point.x} cy={point.y} r="1.2" style={{ fill: 'var(--color-danger)' }} />
          )
        ))}
        <text x="2" y="20" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>{formatDuration(maxP95)}</text>
        <text x="2" y="66" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>0</text>
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
        <span>峰值样本 {maxCount} 条/桶</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-warning)' }} /> P95
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-danger)' }} /> 存在失败样本
        </span>
      </div>
    </div>
  )
}

/** 当前指标的最近样本折线；阈值线只在有样本超过纵轴下界时绘制。 */
export function TrendChart({
  samples, color, thresholdMs,
}: {
  samples: PerformanceSample[]
  color: string
  thresholdMs: number
}) {
  const chartSamples = samples.slice(-40)
  if (chartSamples.length === 0) {
    return <div className={PANEL}><PanelTitle title="最近样本趋势" hint="选择上方一行指标后展示" /><EmptyState size="sm" className="h-[180px]" title="暂无趋势数据" /></div>
  }
  const maxDuration = Math.max(...chartSamples.map((sample) => sample.durationMs), 1)
  const points = chartSamples.map((sample, index) => ({
    x: chartSamples.length === 1 ? 50 : 8 + (84 * index) / (chartSamples.length - 1),
    y: 88 - Math.min(sample.durationMs / maxDuration, 1) * 70,
    sample,
  }))
  const linePath = points.map((point) => `${point.x},${point.y}`).join(' ')
  const areaPath = `M ${points[0].x} 88 L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} 88 Z`
  const thresholdY = thresholdMs > 0 && thresholdMs < maxDuration
    ? 88 - (thresholdMs / maxDuration) * 70
    : null

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelTitle title="最近样本趋势" hint={`展示最近 ${chartSamples.length} 个样本的耗时波动`} />
        <div className="text-right text-[11px] text-[var(--color-text-muted)]">
          <div>峰值 {formatDuration(maxDuration)}</div>
          <div>{formatCompactDateTime(chartSamples[0].timestamp)} - {formatCompactDateTime(chartSamples[chartSamples.length - 1].timestamp)}</div>
        </div>
      </div>
      <svg viewBox="0 0 100 100" className="mt-4 h-[210px] w-full overflow-visible" role="img" aria-label="当前指标最近样本耗时趋势">
        <line x1="8" y1="88" x2="94" y2="88" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        <line x1="8" y1="18" x2="8" y2="88" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        {thresholdY !== null && (
          <g>
            <line x1="8" y1={thresholdY} x2="94" y2={thresholdY} strokeDasharray="2 2" strokeWidth="0.8" style={{ stroke: 'var(--color-warning)' }} />
            <text x="94" y={thresholdY - 2} textAnchor="end" fontSize="3.4" style={{ fill: 'var(--color-warning)' }}>阈值</text>
          </g>
        )}
        <path d={areaPath} style={{ fill: `color-mix(in srgb, ${color} 14%, transparent)` }} />
        <polyline fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" points={linePath} style={{ stroke: color }} />
        {points.map((point) => (
          <circle
            key={point.sample.id} cx={point.x} cy={point.y} r="1.5"
            style={{ fill: point.sample.success ? color : 'var(--color-danger)' }}
          />
        ))}
        <text x="3" y="20" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>{formatDuration(maxDuration)}</text>
        <text x="3" y="90" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>0</text>
      </svg>
      <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
        圆点为单次采样，<span style={{ color: 'var(--color-danger)' }}>红色</span>表示失败；虚线为该指标阈值
      </div>
    </div>
  )
}

export function ActiveMetricSummary({ stat }: { stat: MetricStatistics | null }) {
  if (!stat) {
    return (
      <div className={PANEL}>
        <PanelTitle title="当前指标" hint="在指标统计表中选择一行" />
        <EmptyState size="sm" className="h-[180px]" title="尚未选择指标" />
      </div>
    )
  }
  const cells = [
    { label: '平均耗时', value: formatDuration(stat.avgMs) },
    { label: 'P50', value: formatDuration(stat.p50Ms) },
    { label: 'P99', value: formatDuration(stat.p99Ms) },
    { label: '阈值', value: formatDuration(stat.thresholdMs) },
    { label: '最大值', value: formatDuration(stat.maxMs) },
    { label: '慢 / 失败', value: `${stat.slowCount} / ${stat.failCount}` },
  ]
  return (
    <div className={PANEL}>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: stat.color }} />
        <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{stat.label}</span>
      </div>
      <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">{stat.description || stat.categoryLabel}</div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--color-text-muted)]">{cell.label}</div>
            <div className="mt-1 text-[16px] font-semibold text-[var(--color-text-primary)]">{cell.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
