import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'

import {
  average,
  formatCompactDateTime,
  formatDuration,
  formatSuccessRate,
  percentile,
} from '@/shared/observability/performanceMetrics'
import type {
  LogEntrySnapshot as LogEntry,
  PerformanceMetricDefinition,
  PerformanceMetricId,
  PerformanceSample,
} from '../../public'
import { useMonitorHost } from './hostContext'
import { useMonitorStore } from '@/stores/monitorStore'
import { EmptyState } from '@/shared/ui/EmptyState'

type MetricSummary = {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  count: number
  successRate: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  slowCount: number
}

function mergePerformanceSamples(entries: PerformanceSample[], incoming: PerformanceSample[]): PerformanceSample[] {
  if (incoming.length === 0) return entries
  const existingIds = new Set(entries.map((entry) => entry.id))
  const merged = [...entries]
  for (const entry of incoming) {
    if (existingIds.has(entry.id)) continue
    existingIds.add(entry.id)
    merged.push(entry)
  }
  return merged.sort((a, b) => a.timestampMs - b.timestampMs)
}

function PerformanceHeroCard({ title, value, hint, accent }: { title: string; value: string; hint: string; accent: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 shadow-sm min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-[var(--color-text-muted)]">{title}</div>
      <div className="mt-2 text-[26px] font-bold leading-none" style={{ color: accent }}>{value}</div>
      <div className="mt-2 text-[12px] text-[var(--color-text-secondary)]">{hint}</div>
    </div>
  )
}

function MetricCard({ summary, active, onClick }: { summary: MetricSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition-all duration-75 bg-[var(--color-surface)] shadow-sm hover:border-[var(--metric-color)] hover:shadow-md ${active ? 'ring-2 ring-[var(--metric-color)]/20 border-[var(--metric-color)]' : 'border-[var(--color-border-subtle)]'}`}
      style={{ ['--metric-color' as string]: summary.color }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{summary.label}</span>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${summary.color}18`, color: summary.color }}>
          {summary.count} 条
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] text-[var(--color-text-muted)]">P50</div>
          <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">{formatDuration(summary.p50Ms)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-muted)]">P95</div>
          <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">{formatDuration(summary.p95Ms)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-muted)]">成功率</div>
          <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">{formatSuccessRate(summary.successRate)}</div>
        </div>
      </div>
    </button>
  )
}

function TrendChart({ samples, color }: { samples: PerformanceSample[]; color: string }) {
  const chartSamples = samples.slice(-24)
  if (chartSamples.length === 0) {
    return <EmptyState size="sm" className="h-[220px]" title="暂无趋势数据" />
  }

  const maxDuration = Math.max(...chartSamples.map((sample) => sample.durationMs), 1)
  const points = chartSamples.map((sample, index) => {
    const x = chartSamples.length === 1 ? 50 : 8 + (84 * index) / (chartSamples.length - 1)
    const y = 88 - (Math.min(sample.durationMs / maxDuration, 1) * 70)
    return { x, y, sample }
  })
  const linePath = points.map((point) => `${point.x},${point.y}`).join(' ')
  const areaPath = `M ${points[0].x} 88 L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} 88 Z`

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">最近样本趋势</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">展示最近 {chartSamples.length} 个样本的耗时波动</div>
        </div>
        <div className="text-right text-[11px] text-[var(--color-text-muted)]">
          <div>峰值 {formatDuration(maxDuration)}</div>
          <div>{formatCompactDateTime(chartSamples[0].timestamp)} - {formatCompactDateTime(chartSamples[chartSamples.length - 1].timestamp)}</div>
        </div>
      </div>
      <svg viewBox="0 0 100 100" className="mt-4 h-[220px] w-full overflow-visible">
        <line x1="8" y1="88" x2="94" y2="88" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        <line x1="8" y1="18" x2="8" y2="88" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        <line x1="8" y1="53" x2="94" y2="53" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" strokeDasharray="2 2" />
        <path d={areaPath} fill={`${color}16`} />
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={linePath} />
        {points.map((point) => (
          <circle key={point.sample.id} cx={point.x} cy={point.y} r="1.7" fill={point.sample.success ? color : 'var(--color-danger)'} />
        ))}
        <text x="3" y="20" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>{formatDuration(maxDuration)}</text>
        <text x="3" y="90" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>0</text>
      </svg>
    </div>
  )
}

function DistributionChart({ summaries }: { summaries: MetricSummary[] }) {
  const visible = summaries.filter((summary) => summary.count > 0)
  if (visible.length === 0) {
    return <EmptyState size="sm" bordered className="bg-[var(--color-surface)] shadow-[var(--shadow-sm)]" title="暂无分布数据" />
  }
  const maxValue = Math.max(...visible.flatMap((summary) => [summary.p50Ms, summary.p95Ms]), 1)
  const slotWidth = 100 / visible.length
  const barWidth = Math.min(10, slotWidth * 0.24)

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">P50 / P95 分布</div>
      <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">用于快速识别哪条链路尾延迟最高</div>
      <svg viewBox="0 0 100 78" className="mt-4 h-[220px] w-full">
        <line x1="6" y1="64" x2="96" y2="64" style={{ stroke: 'var(--color-border-subtle)' }} strokeWidth="1" />
        {visible.map((summary, index) => {
          const center = slotWidth * index + slotWidth / 2
          const p50Height = (summary.p50Ms / maxValue) * 44
          const p95Height = (summary.p95Ms / maxValue) * 44
          return (
            <g key={summary.id}>
              <rect x={center - barWidth - 1} y={64 - p50Height} width={barWidth} height={p50Height} rx="1.5" fill={`${summary.color}99`} />
              <rect x={center + 1} y={64 - p95Height} width={barWidth} height={p95Height} rx="1.5" fill={summary.color} />
              <text x={center} y="70" textAnchor="middle" fontSize="3.4" style={{ fill: 'var(--color-text-secondary)' }}>{summary.shortLabel}</text>
            </g>
          )
        })}
        <text x="2" y="22" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>{formatDuration(maxValue)}</text>
        <text x="2" y="66" fontSize="4" style={{ fill: 'var(--color-text-muted)' }}>0</text>
      </svg>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[color-mix(in_srgb,var(--color-text-secondary)_60%,transparent)]" /> P50</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-text-secondary)]" /> P95</span>
      </div>
    </div>
  )
}

function SuccessRatePanel({ summaries }: { summaries: MetricSummary[] }) {
  const visible = summaries.filter((summary) => summary.count > 0)
  if (visible.length === 0) {
    return <EmptyState size="sm" bordered className="bg-[var(--color-surface)] shadow-[var(--shadow-sm)]" title="暂无成功率数据" />
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">成功率与慢操作占比</div>
      <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">慢操作定义为超过该指标阈值的成功样本</div>
      <div className="mt-4 space-y-4">
        {visible.map((summary) => {
          const slowRate = summary.count === 0 ? 0 : (summary.slowCount / summary.count) * 100
          return (
            <div key={summary.id}>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="font-medium text-[var(--color-text-primary)]">{summary.label}</span>
                <span className="text-[var(--color-text-muted)]">{formatSuccessRate(summary.successRate)} / 慢 {formatSuccessRate(slowRate)}</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#edf2f7]">
                <div className="h-full rounded-full" style={{ width: `${summary.successRate}%`, backgroundColor: summary.color }} />
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
                <div className="h-full rounded-full bg-[#f59e0b]" style={{ width: `${slowRate}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatSampleContext(sample: PerformanceSample): string {
  const roomPath = typeof sample.params.roomPath === 'string' ? sample.params.roomPath : ''
  const nodePath = typeof sample.params.nodePath === 'string' ? sample.params.nodePath : ''
  const documentPath = typeof sample.params.documentPath === 'string' ? sample.params.documentPath : ''
  return roomPath || nodePath || documentPath || sample.module || '未命名上下文'
}

function RecentSamplesPanel({ samples }: { samples: PerformanceSample[] }) {
  const slowest = [...samples].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8)
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">最慢样本</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">帮助快速定位拖慢体验的链路和上下文</div>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
        <div className="grid grid-cols-[84px_110px_90px_1fr] bg-[var(--color-bg-muted)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text-muted)]">
          <span>时间</span>
          <span>指标</span>
          <span>耗时</span>
          <span>上下文</span>
        </div>
        {slowest.length === 0 ? (
          <EmptyState size="sm" className="py-6" title="暂无样本" />
        ) : (
          slowest.map((sample) => (
            <div key={sample.id} className="grid grid-cols-[84px_110px_90px_1fr] items-center gap-3 border-t border-[var(--color-border-subtle)] px-3 py-2 text-[12px]">
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{formatCompactDateTime(sample.timestamp)}</span>
              <span className="font-medium" style={{ color: sample.color }}>{sample.label}</span>
              <span className={`font-semibold ${sample.success ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-danger)]'}`}>{formatDuration(sample.durationMs)}</span>
              <span className="truncate text-[var(--color-text-secondary)]" title={formatSampleContext(sample)}>{formatSampleContext(sample)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function PerformanceTab() {
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const streaming = useMonitorStore((s) => s.streaming)
  const { logs, performance } = useMonitorHost()
  const [performanceSamples, setPerformanceSamples] = useState<PerformanceSample[]>([])
  const [errorCount, setErrorCount] = useState(0)

  const metricDefinitions = useMemo(() => performance.getMetricDefinitions(), [performance])
  const metricDefinitionMap = useMemo(
    () => Object.fromEntries(metricDefinitions.map((definition) => [definition.id, definition])) as Record<PerformanceMetricId, PerformanceMetricDefinition>,
    [metricDefinitions],
  )

  useEffect(() => {
    let cancelled = false
    setPerformanceSamples([])

    const loadSamples = async () => {
      const results = await performance.querySamples({
        date: selectedDate || null,
      })
      if (cancelled) return
      setPerformanceSamples((current) => mergePerformanceSamples(current, results))
    }

    void loadSamples()

    return () => {
      cancelled = true
    }
  }, [performance, selectedDate])

  useEffect(() => {
    if (!streaming) return

    const subscription = performance.subscribeSamples((sample) => {
      setPerformanceSamples((current) => mergePerformanceSamples(current, [sample]))
    }, { date: selectedDate || null })
    return () => {
      subscription.dispose()
    }
  }, [performance, selectedDate, streaming])

  useEffect(() => {
    let cancelled = false

    const loadErrorCount = async () => {
      const results = (await logs.query({
        date: selectedDate || undefined,
        levels: ['ERROR'],
      })) as LogEntry[]
      if (!cancelled) {
        setErrorCount(results.length)
      }
    }

    void loadErrorCount()

    return () => {
      cancelled = true
    }
  }, [logs, selectedDate])

  const summaries = useMemo<MetricSummary[]>(() => {
    return metricDefinitions.map((definition) => {
      const samples = performanceSamples.filter((sample) => sample.metric === definition.id)
      const durations = [...samples.map((sample) => sample.durationMs)].sort((a, b) => a - b)
      const successCount = samples.filter((sample) => sample.success).length
      const slowCount = samples.filter((sample) => sample.success && sample.durationMs > definition.thresholdMs).length
      return {
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        color: definition.color,
        thresholdMs: definition.thresholdMs,
        count: samples.length,
        successRate: samples.length === 0 ? 0 : (successCount / samples.length) * 100,
        avgMs: average(durations),
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        slowCount,
      }
    })
  }, [metricDefinitions, performanceSamples])

  const availableSummaries = summaries.filter((summary) => summary.count > 0)
  const [activeMetric, setActiveMetric] = useState<PerformanceMetricId>(
    metricDefinitions[0]?.id ?? 'room_load',
  )

  useEffect(() => {
    if (!metricDefinitions.some((summary) => summary.id === activeMetric)) {
      setActiveMetric(metricDefinitions[0]?.id ?? 'room_load')
    }
  }, [activeMetric, metricDefinitions])

  const activeSamples = useMemo(
    () => performanceSamples.filter((sample) => sample.metric === activeMetric),
    [performanceSamples, activeMetric],
  )

  const totalSamples = performanceSamples.length
  const successCount = performanceSamples.filter((sample) => sample.success).length
  const slowSamples = performanceSamples.filter((sample) => sample.success && sample.durationMs > sample.thresholdMs).length

  if (totalSamples === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-bg-app)]">
        <EmptyState
          size="md"
          icon={<Activity className="h-6 w-6" />}
          title="暂无性能样本"
          description="先在图谱中执行加载房间、点选节点、读取或保存详情文档，再回来查看指标"
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-bg-app)] px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[18px] font-semibold text-[var(--color-text-primary)]">性能监控</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            核心链路已接入真实采样
            {selectedDate ? `，当前筛选日期 ${selectedDate}` : '，当前展示全部日期'}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PerformanceHeroCard title="性能样本" value={String(totalSamples)} hint="来自关键链路的耗时日志" accent="#3b82f6" />
        <PerformanceHeroCard title="总体成功率" value={formatSuccessRate(totalSamples === 0 ? 0 : (successCount / totalSamples) * 100)} hint="失败样本会用 WARN 记录" accent="#10b981" />
        <PerformanceHeroCard title="慢操作" value={String(slowSamples)} hint="超过各指标阈值的成功样本" accent="#f59e0b" />
        <PerformanceHeroCard title="错误日志" value={String(errorCount)} hint="便于对照稳定性与性能问题" accent="#ef4444" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <DistributionChart summaries={summaries} />
        <SuccessRatePanel summaries={summaries} />
      </div>

      <div className="mt-5">
        <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">指标卡片</div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {availableSummaries.map((summary) => (
            <MetricCard
              key={summary.id}
              summary={summary}
              active={summary.id === activeMetric}
              onClick={() => setActiveMetric(summary.id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <TrendChart samples={activeSamples} color={metricDefinitionMap[activeMetric]?.color ?? '#3b82f6'} />
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">当前指标摘要</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">{metricDefinitionMap[activeMetric]?.label ?? activeMetric}</div>
          {(() => {
            const summary = summaries.find((item) => item.id === activeMetric)
            if (!summary) return null
            return (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-3">
                  <div className="text-[11px] text-[var(--color-text-muted)]">平均耗时</div>
                  <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{formatDuration(summary.avgMs)}</div>
                </div>
                <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-3">
                  <div className="text-[11px] text-[var(--color-text-muted)]">阈值</div>
                  <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{formatDuration(summary.thresholdMs)}</div>
                </div>
                <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-3">
                  <div className="text-[11px] text-[var(--color-text-muted)]">P95</div>
                  <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{formatDuration(summary.p95Ms)}</div>
                </div>
                <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-3">
                  <div className="text-[11px] text-[var(--color-text-muted)]">慢样本</div>
                  <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{summary.slowCount}</div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      <div className="mt-5 pb-4">
        <RecentSamplesPanel samples={performanceSamples} />
      </div>
    </div>
  )
}
