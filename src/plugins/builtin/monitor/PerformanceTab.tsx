/**
 * 性能监控页组装层。
 * 数据、筛选、统计、可视化分别下沉到 performance/ 目录，本文件只负责编排。
 */
import { useCallback, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'

import { EmptyState } from '@/shared/ui/EmptyState'
import {
  bucketPerformanceSamples,
  computeCalibrationSummary,
  computeCategoryStatistics,
  computeMetricStatistics,
  computeOperationStatistics,
  computePerformanceOverview,
  computeScaleCalibration,
  computeScaleStatistics,
  computeTrend,
  groupByTrace,
} from '@/shared/observability/performanceStatistics'
import { ActiveMetricSummary, DistributionChart, TimeBucketChart, TrendChart } from './performance/PerformanceCharts'
import { MetricStatisticsTable } from './performance/MetricStatisticsTable'
import { PerformanceOverview } from './performance/PerformanceOverview'
import { PerformanceToolbar } from './performance/PerformanceToolbar'
import { ScaleBucketsPanel } from './performance/ScaleBucketsPanel'
import { ScaleCalibrationPanel } from './performance/ScaleCalibrationPanel'
import { SlowSamplesPanel } from './performance/SlowSamplesPanel'
import { TraceWaterfallPanel } from './performance/TraceWaterfallPanel'
import { usePerformanceSamples } from './performance/usePerformanceSamples'

export default function PerformanceTab() {
  const {
    definitions, samples, filteredSamples, errorCount,
    filters, setFilters, resetFilters, refresh,
    streaming, setStreaming, selectedDate,
    activeMetric, setActiveMetric,
  } = usePerformanceSamples()
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)

  const stats = useMemo(
    () => computeMetricStatistics(filteredSamples, definitions),
    [filteredSamples, definitions],
  )
  const categoryStats = useMemo(() => computeCategoryStatistics(filteredSamples), [filteredSamples])
  const overview = useMemo(
    () => computePerformanceOverview(filteredSamples, definitions),
    [filteredSamples, definitions],
  )
  const trend = useMemo(() => computeTrend(filteredSamples), [filteredSamples])
  const buckets = useMemo(() => bucketPerformanceSamples(filteredSamples, 24), [filteredSamples])
  const scaleBuckets = useMemo(() => computeScaleStatistics(filteredSamples), [filteredSamples])
  const operations = useMemo(() => computeOperationStatistics(filteredSamples), [filteredSamples])
  const traces = useMemo(() => groupByTrace(filteredSamples), [filteredSamples])
  const hasCanvasSamples = filteredSamples.some((sample) => sample.category === 'canvas')
  // 标定基于当前日志日期的全部样本，不受页面筛选影响，避免筛选后样本不足误判。
  const calibrationRows = useMemo(() => computeScaleCalibration(samples), [samples])
  const calibrationSummary = useMemo(() => computeCalibrationSummary(calibrationRows), [calibrationRows])

  /** 导出的 JSON 与 perf:calibrate --input 的 {samples:[...]} 形状一致。 */
  const handleExportSamples = useCallback(() => {
    if (samples.length === 0) return
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      date: selectedDate,
      samples,
    }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `topomind-perf-samples-${selectedDate ?? 'all'}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [samples, selectedDate])

  // 纯派生：未选择或所选指标被筛掉时，自动落到 P95 最高的已采样指标，无需 effect 回写。
  const available = stats.filter((item) => item.count > 0)
  const autoMetric = [...available].sort((a, b) => b.p95Ms - a.p95Ms)[0]?.metric ?? null
  const resolvedActive = activeMetric && available.some((item) => item.metric === activeMetric)
    ? activeMetric
    : autoMetric
  const activeStat = stats.find((item) => item.metric === resolvedActive) ?? null
  const activeSamples = useMemo(
    () => (resolvedActive ? filteredSamples.filter((sample) => sample.metric === resolvedActive) : []),
    [filteredSamples, resolvedActive],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-app)]">
      <PerformanceToolbar
        filters={filters}
        onFiltersChange={setFilters}
        onReset={resetFilters}
        onRefresh={refresh}
        streaming={streaming}
        onStreamingChange={setStreaming}
        selectedDate={selectedDate}
        sampleCount={filteredSamples.length}
        totalCount={samples.length}
        errorCount={errorCount}
        metricCount={definitions.length}
        onExport={handleExportSamples}
      />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {samples.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              size="md"
              icon={<Activity className="h-6 w-6" />}
              title="暂无性能样本"
              description="在图谱中加载房间、点选节点、读写文档或打开知识库后，这里会展示真实采样"
            />
          </div>
        ) : (
          <>
            {filteredSamples.length === 0 && (
              <div className="rounded-lg border px-4 py-3 text-[12px]"
                style={{ borderColor: 'var(--color-warning-border)', background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
                当前筛选条件下没有样本，可放宽时间范围或重置筛选。
              </div>
            )}

            <PerformanceOverview
              overview={overview}
              categories={categoryStats}
              trend={trend}
              sensitiveOperations={operations}
            />

            <div className="mt-5">
              <MetricStatisticsTable
                stats={stats}
                activeMetric={resolvedActive}
                onSelect={setActiveMetric}
              />
            </div>

            {hasCanvasSamples && (
              <div className="mt-5">
                <ScaleBucketsPanel buckets={scaleBuckets} operations={operations} />
              </div>
            )}

            {hasCanvasSamples && (
              <div className="mt-5">
                <ScaleCalibrationPanel rows={calibrationRows} summary={calibrationSummary} />
              </div>
            )}

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <TimeBucketChart buckets={buckets} />
              <DistributionChart stats={stats} />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <TrendChart
                samples={activeSamples}
                color={activeStat?.color ?? 'var(--color-accent)'}
                thresholdMs={activeStat?.thresholdMs ?? 0}
              />
              <ActiveMetricSummary stat={activeStat} />
            </div>

            {hasCanvasSamples && (
              <div className="mt-5">
                <TraceWaterfallPanel
                  groups={traces}
                  selectedTraceId={selectedTraceId}
                  onSelect={setSelectedTraceId}
                />
              </div>
            )}

            <div className="mt-5 pb-4">
              <SlowSamplesPanel
                samples={filteredSamples}
                selectedTraceId={selectedTraceId}
                onSelectTrace={setSelectedTraceId}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
