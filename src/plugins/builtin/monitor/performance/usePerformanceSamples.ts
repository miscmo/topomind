/**
 * 性能页的数据层：取数、流式订阅、宿主定义归一化、时间/分类/状态筛选。
 * 组件只消费这里返回的派生结果，不自己碰 IPC 或 Zustand 订阅。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  PERFORMANCE_CATEGORIES,
  PERFORMANCE_METRIC_SPEC_BY_ID,
  performanceMetricCategory,
  type PerformanceCategoryId,
  type PerformanceMetricId,
} from '@/shared/observability/performanceContract'
import { PERFORMANCE_METRIC_DEFINITION_LIST } from '@/shared/observability/performanceMetrics'
import type { PerformanceSample as SharedPerformanceSample } from '@/shared/observability/performanceMetrics'
import {
  DEFAULT_PERFORMANCE_FILTERS,
  filterPerformanceSamples,
  type PerformanceFilters,
} from '@/shared/observability/performanceStatistics'
import type {
  LogEntrySnapshot,
  PerformanceMetricDefinition,
  PerformanceSample as PublicPerformanceSample,
} from '../../../public'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import { useMonitorHost } from '../hostContext'

/** 宿主可能只给出基础字段（权限 mock / 旧宿主），分类元数据从注册表补齐。 */
function normalizeDefinition(definition: PerformanceMetricDefinition): PerformanceMetricDefinition & {
  category: PerformanceCategoryId
  categoryLabel: string
} {
  const local = PERFORMANCE_METRIC_DEFINITION_LIST.find((item) => item.id === definition.id)
  const category = definition.category ?? local?.category ?? performanceMetricCategory(definition.id)
  return {
    ...(local ?? {}),
    ...definition,
    category,
    categoryLabel: definition.categoryLabel ?? local?.categoryLabel ?? PERFORMANCE_CATEGORIES[category].label,
    description: definition.description ?? local?.description ?? '',
    color: definition.color || PERFORMANCE_CATEGORIES[category].color,
  }
}

function normalizeSample(sample: PublicPerformanceSample): SharedPerformanceSample {
  return {
    ...sample,
    category: sample.category ?? performanceMetricCategory(sample.metric),
    thresholdMs: sample.thresholdMs || PERFORMANCE_METRIC_SPEC_BY_ID[sample.metric]?.thresholdMs || 1000,
    params: sample.params ?? {},
  }
}

function mergeSamples(entries: SharedPerformanceSample[], incoming: SharedPerformanceSample[]): SharedPerformanceSample[] {
  if (incoming.length === 0) return entries
  const existingIds = new Set(entries.map((entry) => entry.id))
  const merged = [...entries]
  for (const entry of incoming) {
    if (existingIds.has(entry.id)) continue
    existingIds.add(entry.id)
    merged.push(entry)
  }
  // 与日志缓冲同量级上限，防止长时间开着监控页无限增长。
  const trimmed = merged.length > 5000 ? merged.slice(-5000) : merged
  return trimmed.sort((a, b) => a.timestampMs - b.timestampMs)
}

export function usePerformanceSamples() {
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const streaming = useMonitorStore((s) => s.streaming)
  const setStreaming = useMonitorStore((s) => s.setStreaming)
  const { logs, performance } = useMonitorHost()

  const [samples, setSamples] = useState<SharedPerformanceSample[]>([])
  const [errorCount, setErrorCount] = useState(0)
  const [refreshToken, setRefreshToken] = useState(0)
  const [filters, setFilters] = useState<PerformanceFilters>(DEFAULT_PERFORMANCE_FILTERS)
  const [activeMetric, setActiveMetric] = useState<PerformanceMetricId | null>(null)

  const definitions = useMemo(
    () => performance.getMetricDefinitions().map(normalizeDefinition),
    [performance],
  )

  useEffect(() => {
    let cancelled = false
    setSamples([])

    const load = async () => {
      const results = await performance.querySamples({ date: selectedDate || null })
      if (!cancelled) setSamples(mergeSamples([], results.map(normalizeSample)))
    }
    void load()
    return () => { cancelled = true }
  }, [performance, selectedDate, refreshToken])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const results = await logs.query({ date: selectedDate || undefined, levels: ['ERROR'] })
      if (!cancelled) setErrorCount((results as LogEntrySnapshot[]).length)
    }
    void load()
    return () => { cancelled = true }
  }, [logs, selectedDate, refreshToken])

  useEffect(() => {
    if (!streaming) return
    const subscription = performance.subscribeSamples((sample) => {
      setSamples((current) => mergeSamples(current, [normalizeSample(sample)]))
    }, { date: selectedDate || null })
    return () => subscription.dispose()
  }, [performance, selectedDate, streaming])

  const filteredSamples = useMemo(
    () => filterPerformanceSamples(samples, filters),
    [samples, filters],
  )

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])
  const resetFilters = useCallback(() => setFilters(DEFAULT_PERFORMANCE_FILTERS), [])

  return {
    definitions,
    samples,
    filteredSamples,
    errorCount,
    filters,
    setFilters,
    resetFilters,
    refresh,
    streaming,
    setStreaming,
    selectedDate,
    activeMetric,
    setActiveMetric,
  }
}
