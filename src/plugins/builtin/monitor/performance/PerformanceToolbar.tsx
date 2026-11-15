import { Download, RefreshCw, RotateCcw, Search, X } from 'lucide-react'

import {
  PERFORMANCE_CATEGORIES,
  PERFORMANCE_CATEGORY_IDS,
  type PerformanceCategoryId,
} from '@/shared/observability/performanceContract'
import {
  CANVAS_OPERATION_OPTIONS,
  SCALE_BUCKET_LABELS,
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  type PerformanceFilters,
  type SampleStatusFilter,
  type ScaleBucketId,
  type TimeRangePreset,
} from '@/shared/observability/performanceStatistics'

interface PerformanceToolbarProps {
  filters: PerformanceFilters
  onFiltersChange: (filters: PerformanceFilters) => void
  onReset: () => void
  onRefresh: () => void
  streaming: boolean
  onStreamingChange: (value: boolean) => void
  selectedDate: string | null
  sampleCount: number
  totalCount: number
  errorCount: number
  metricCount: number
  /** 导出当前日志日期的全部样本，供 perf:calibrate --input 直接消费。 */
  onExport: () => void
}

const INPUT_CLASS = 'h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]'

export function PerformanceToolbar({
  filters, onFiltersChange, onReset, onRefresh, streaming, onStreamingChange,
  selectedDate, sampleCount, totalCount, errorCount, metricCount, onExport,
}: PerformanceToolbarProps) {
  const toggleCategory = (category: PerformanceCategoryId) => {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((item) => item !== category)
      : [...filters.categories, category]
    onFiltersChange({ ...filters, categories: next })
  }

  return (
    <div className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-5 py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">性能监控</h1>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            已接入 {metricCount} 项指标 · {selectedDate ? `日志日期 ${selectedDate}` : '全部日志日期'}
            {' · '}同期错误日志 {errorCount} 条
          </div>
        </div>
        <div className="text-[12px] text-[var(--color-text-secondary)]">
          显示 <span className="font-semibold text-[var(--color-text-primary)]">{sampleCount}</span> / {totalCount} 条样本
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={INPUT_CLASS}
          aria-label="时间范围"
          value={filters.range}
          onChange={(event) => onFiltersChange({ ...filters, range: event.target.value as TimeRangePreset })}
        >
          {(Object.keys(TIME_RANGE_LABELS) as TimeRangePreset[]).map((range) => (
            <option key={range} value={range}>{TIME_RANGE_LABELS[range]}</option>
          ))}
        </select>

        <select
          className={INPUT_CLASS}
          aria-label="样本状态"
          value={filters.status}
          onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as SampleStatusFilter })}
        >
          {(Object.keys(STATUS_LABELS) as SampleStatusFilter[]).map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>

        <select
          className={INPUT_CLASS}
          aria-label="节点规模"
          value={filters.scaleBucket}
          onChange={(event) => onFiltersChange({
            ...filters,
            scaleBucket: event.target.value as ScaleBucketId | 'all',
          })}
        >
          {(Object.keys(SCALE_BUCKET_LABELS) as Array<ScaleBucketId | 'all'>).map((bucket) => (
            <option key={bucket} value={bucket}>{SCALE_BUCKET_LABELS[bucket]}</option>
          ))}
        </select>

        <select
          className={INPUT_CLASS}
          aria-label="画布动作"
          value={filters.operation ?? 'all'}
          onChange={(event) => onFiltersChange({ ...filters, operation: event.target.value })}
        >
          {CANVAS_OPERATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1">
          {PERFORMANCE_CATEGORY_IDS.map((category) => {
            const active = filters.categories.includes(category)
            const color = PERFORMANCE_CATEGORIES[category].color
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                className="h-7 rounded-md border px-2 text-[11px] font-medium transition-colors duration-75"
                style={{
                  borderColor: active ? color : 'var(--color-border)',
                  background: active ? `color-mix(in srgb, ${color} 14%, var(--color-surface))` : 'var(--color-surface)',
                  color: active ? color : 'var(--color-text-secondary)',
                }}
                title={PERFORMANCE_CATEGORIES[category].label}
              >
                {PERFORMANCE_CATEGORIES[category].label}
              </button>
            )
          })}
        </div>

        <div className="relative flex min-w-[160px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <input
            className={`${INPUT_CLASS} w-full pl-[26px] pr-[26px]`}
            aria-label="搜索样本"
            placeholder="搜索指标或上下文"
            value={filters.keyword}
            onChange={(event) => onFiltersChange({ ...filters, keyword: event.target.value })}
          />
          {filters.keyword && (
            <button
              type="button"
              className="absolute right-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              onClick={() => onFiltersChange({ ...filters, keyword: '' })}
              title="清空关键词"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <label className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-muted)] [&>input]:accent-[var(--color-primary)]">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(event) => onStreamingChange(event.target.checked)}
          />
          实时
        </label>
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]"
          onClick={onRefresh}
          title="重新读取样本"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]"
          onClick={onReset}
          title="重置筛选"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] disabled:opacity-50"
          onClick={onExport}
          disabled={totalCount === 0}
          title={`导出当前日期全部 ${totalCount} 条样本（JSON，可直接用于 perf:calibrate --input）`}
        >
          <Download className="h-3.5 w-3.5" />
          导出样本
        </button>
      </div>
    </div>
  )
}
