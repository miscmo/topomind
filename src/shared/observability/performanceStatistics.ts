/**
 * 性能指标计算与统计 —— 纯函数层，零 DOM / 零 React / 零 IPC 依赖。
 *
 * 这里只做「样本 → 指标」的推导，不负责取数（取数在宿主 PerformanceApi），
 * 也不负责渲染（渲染在 builtin/monitor/performance/）。因此可以被回归脚本用
 * esbuild 打包后真跑，而不是只检查源码里有没有某几个字符串。
 */
import {
  CANVAS_OPERATION_LABELS,
  CANVAS_OPERATION_THRESHOLDS,
  PERFORMANCE_CATEGORIES,
  PERFORMANCE_CATEGORY_IDS,
  type CanvasOperationId,
  type PerformanceCategoryId,
  type PerformanceMetricId,
} from './performanceContract'
import {
  average,
  percentile,
  type PerformanceSample,
} from './performanceMetrics'

export type TimeRangePreset = 'all' | '15m' | '1h' | '24h'
export type SampleStatusFilter = 'all' | 'success' | 'failed' | 'slow'

export const TIME_RANGE_LABELS: Record<TimeRangePreset, string> = {
  all: '全部',
  '15m': '近 15 分钟',
  '1h': '近 1 小时',
  '24h': '近 24 小时',
}

export const STATUS_LABELS: Record<SampleStatusFilter, string> = {
  all: '全部状态',
  success: '仅成功',
  failed: '仅失败',
  slow: '仅慢操作',
}

export interface PerformanceFilters {
  range: TimeRangePreset
  /** 空数组表示不过滤 */
  categories: PerformanceCategoryId[]
  metrics: PerformanceMetricId[]
  status: SampleStatusFilter
  keyword: string
  /** 画布规模分桶；'all' 表示不按节点数过滤。 */
  scaleBucket: ScaleBucketId | 'all'
  /** 画布动作维度；'all' 或空表示不过滤。可选字段兼容宿主只传部分筛选。 */
  operation?: string
  /** 注入当前时间，纯函数可测试；默认 Date.now()。 */
  nowMs?: number
}

export const DEFAULT_PERFORMANCE_FILTERS: PerformanceFilters = {
  range: 'all',
  categories: [],
  metrics: [],
  status: 'all',
  keyword: '',
  scaleBucket: 'all',
  operation: 'all',
}

/** 工具条下拉选项，直接由契约里的中文标签派生，新增动作无需改页面。 */
export const CANVAS_OPERATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部动作' },
  ...Object.entries(CANVAS_OPERATION_LABELS).map(([value, label]) => ({ value, label })),
]

const RANGE_MS: Record<TimeRangePreset, number> = {
  all: 0,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

export function timeRangeStartMs(range: TimeRangePreset, nowMs: number): number | null {
  return RANGE_MS[range] === 0 ? null : nowMs - RANGE_MS[range]
}

/** 慢操作 = 成功但超过该指标阈值；失败样本单独统计，不混进慢操作。 */
export function isSlowSample(sample: PerformanceSample): boolean {
  return sample.success && sample.durationMs > sample.thresholdMs
}

export function formatSampleContext(sample: PerformanceSample): string {
  const params = sample.params ?? {}
  const keys = ['scaleLabel', 'roomPath', 'nodePath', 'documentPath', 'kbPath', 'sourcePath', 'cardPath', 'queryLength']
  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string' && value) return value
  }
  // 写盘侧没有 store 句柄，只落了数字字段；这里补一个规模摘要，慢样本仍可复现。
  const nodeCount = params.nodeCount
  if (typeof nodeCount === 'number' && nodeCount > 0) {
    const hiddenCount = params.hiddenCount
    return typeof hiddenCount === 'number' && hiddenCount > 0
      ? `${nodeCount} 节点 · 隐藏 ${hiddenCount}`
      : `${nodeCount} 节点`
  }
  const error = params.error
  if (typeof error === 'string' && error) return `失败：${error}`
  return sample.source || sample.module || '未命名上下文'
}

function matchesKeyword(sample: PerformanceSample, keyword: string): boolean {
  const q = keyword.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    sample.metric,
    sample.label,
    sample.shortLabel,
    sample.source,
    sample.module,
    formatSampleContext(sample),
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(q)
}

export function filterPerformanceSamples(
  samples: PerformanceSample[],
  input: PerformanceFilters = DEFAULT_PERFORMANCE_FILTERS,
): PerformanceSample[] {
  // 宿主可能只传改动的字段；先与默认筛选合并，避免部分筛选对象直接击穿。
  const filters: PerformanceFilters = { ...DEFAULT_PERFORMANCE_FILTERS, ...input }
  const nowMs = filters.nowMs ?? Date.now()
  const startMs = timeRangeStartMs(filters.range, nowMs)
  const categorySet = filters.categories.length > 0 ? new Set(filters.categories) : null
  const metricSet = filters.metrics.length > 0 ? new Set<string>(filters.metrics) : null

  return samples.filter((sample) => {
    if (startMs !== null && sample.timestampMs < startMs) return false
    if (sample.timestampMs > nowMs + 60_000) return false
    if (categorySet && !categorySet.has(sample.category)) return false
    if (metricSet && !metricSet.has(sample.metric)) return false
    if (filters.status === 'success' && !sample.success) return false
    if (filters.status === 'failed' && sample.success) return false
    if (filters.status === 'slow' && !isSlowSample(sample)) return false
    if (filters.scaleBucket !== 'all') {
      const scale = readSampleScale(sample)
      if (scale.nodeCount <= 0 || scaleBucketOf(scale.nodeCount) !== filters.scaleBucket) return false
    }
    if (filters.operation && filters.operation !== 'all'
      && readSampleScale(sample).operation !== filters.operation) return false
    return matchesKeyword(sample, filters.keyword)
  })
}

/**
 * 统计层只需要定义表的基础字段。宿主插件 API 里的定义是「可选元数据」版本，
 * shared 里的定义是「完整元数据」版本，两者都能直接传进来，避免页面再造一份适配类型。
 */
export interface StatisticsMetricDefinition {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  category?: PerformanceCategoryId
  categoryLabel?: string
  description?: string
}

export interface MetricStatistics {
  metric: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  category: PerformanceCategoryId
  categoryLabel: string
  thresholdMs: number
  description: string
  count: number
  successCount: number
  failCount: number
  slowCount: number
  successRate: number
  slowRate: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  lastTimestampMs: number
}

function rate(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100
}

/** 按定义表顺序输出全部指标（含 count=0），页面可据此显示「已接入但未采样」。 */
export function computeMetricStatistics(
  samples: PerformanceSample[],
  definitions: StatisticsMetricDefinition[],
): MetricStatistics[] {
  const grouped = new Map<string, PerformanceSample[]>()
  for (const sample of samples) {
    const bucket = grouped.get(sample.metric)
    if (bucket) bucket.push(sample)
    else grouped.set(sample.metric, [sample])
  }

  return definitions.map((definition) => {
    const group = grouped.get(definition.id) ?? []
    const durations = group.map((sample) => sample.durationMs).sort((a, b) => a - b)
    const successCount = group.filter((sample) => sample.success).length
    const slowCount = group.filter(isSlowSample).length
    const category = definition.category ?? 'runtime'
    return {
      metric: definition.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      color: definition.color,
      category,
      categoryLabel: definition.categoryLabel ?? PERFORMANCE_CATEGORIES[category].label,
      thresholdMs: definition.thresholdMs,
      description: definition.description ?? '',
      count: group.length,
      successCount,
      failCount: group.length - successCount,
      slowCount,
      successRate: rate(successCount, group.length),
      slowRate: rate(slowCount, group.length),
      avgMs: average(durations),
      minMs: durations[0] ?? 0,
      maxMs: durations[durations.length - 1] ?? 0,
      p50Ms: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      lastTimestampMs: group.reduce((max, sample) => Math.max(max, sample.timestampMs), 0),
    }
  })
}

export interface CategoryStatistics {
  category: PerformanceCategoryId
  label: string
  color: string
  count: number
  failCount: number
  slowCount: number
  p95Ms: number
}

export function computeCategoryStatistics(
  samples: PerformanceSample[],
): CategoryStatistics[] {
  return PERFORMANCE_CATEGORY_IDS.map((category) => {
    const group = samples.filter((sample) => sample.category === category)
    const durations = group.map((sample) => sample.durationMs).sort((a, b) => a - b)
    return {
      category,
      label: PERFORMANCE_CATEGORIES[category].label,
      color: PERFORMANCE_CATEGORIES[category].color,
      count: group.length,
      failCount: group.filter((sample) => !sample.success).length,
      slowCount: group.filter(isSlowSample).length,
      p95Ms: percentile(durations, 0.95),
    }
  })
}

export interface PerformanceOverview {
  total: number
  successCount: number
  failCount: number
  slowCount: number
  successRate: number
  slowRate: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  activeMetricCount: number
  sessionCount: number
  coveredMetricCount: number
  firstTimestampMs: number
  lastTimestampMs: number
}

export function computePerformanceOverview(
  samples: PerformanceSample[],
  definitions: Pick<StatisticsMetricDefinition, 'id'>[],
): PerformanceOverview {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b)
  const successCount = samples.filter((sample) => sample.success).length
  const slowCount = samples.filter(isSlowSample).length
  const sessions = new Set(samples.map((sample) => sample.sessionId).filter(Boolean))
  const metrics = new Set(samples.map((sample) => sample.metric))
  const timestamps = samples.map((sample) => sample.timestampMs)
  return {
    total: samples.length,
    successCount,
    failCount: samples.length - successCount,
    slowCount,
    successRate: rate(successCount, samples.length),
    slowRate: rate(slowCount, samples.length),
    avgMs: average(durations),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    activeMetricCount: metrics.size,
    sessionCount: sessions.size,
    coveredMetricCount: definitions.length,
    firstTimestampMs: timestamps.length ? Math.min(...timestamps) : 0,
    lastTimestampMs: timestamps.length ? Math.max(...timestamps) : 0,
  }
}

export interface TimeBucket {
  startMs: number
  endMs: number
  count: number
  failCount: number
  slowCount: number
  avgMs: number
  p95Ms: number
}

/**
 * 按样本实际时间跨度等宽分桶（不是按固定自然时间），纯函数、不依赖当前时间。
 * 空桶会保留，页面才能看出「这一段没有操作」而不是把折线连起来。
 */
export function bucketPerformanceSamples(
  samples: PerformanceSample[],
  bucketCount = 24,
): TimeBucket[] {
  const count = Math.max(1, Math.floor(bucketCount))
  if (samples.length === 0) return []
  const timestamps = samples.map((sample) => sample.timestampMs)
  const min = Math.min(...timestamps)
  const max = Math.max(...timestamps)
  const span = Math.max(max - min, 60_000)
  const width = span / count
  const buckets: TimeBucket[] = Array.from({ length: count }, (_, index) => ({
    startMs: min + index * width,
    endMs: min + (index + 1) * width,
    count: 0,
    failCount: 0,
    slowCount: 0,
    avgMs: 0,
    p95Ms: 0,
  }))
  const groups: number[][] = Array.from({ length: count }, () => [])
  for (const sample of samples) {
    const index = Math.min(count - 1, Math.floor((sample.timestampMs - min) / width))
    const bucket = buckets[index]
    bucket.count += 1
    if (!sample.success) bucket.failCount += 1
    if (isSlowSample(sample)) bucket.slowCount += 1
    groups[index].push(sample.durationMs)
  }
  for (let index = 0; index < count; index += 1) {
    const sorted = groups[index].sort((a, b) => a - b)
    buckets[index].avgMs = average(sorted)
    buckets[index].p95Ms = percentile(sorted, 0.95)
  }
  return buckets
}

export interface TrendComparison {
  currentMs: number
  previousMs: number
  deltaPercent: number
  direction: 'up' | 'down' | 'flat'
}

/** 前半段 vs 后半段的 P95 变化；样本太少时返回 flat，避免给出误导性结论。 */
export function computeTrend(samples: PerformanceSample[]): TrendComparison {
  if (samples.length < 4) return { currentMs: 0, previousMs: 0, deltaPercent: 0, direction: 'flat' }
  const sorted = [...samples].sort((a, b) => a.timestampMs - b.timestampMs)
  const middle = Math.floor(sorted.length / 2)
  const previous = percentile(sorted.slice(0, middle).map((s) => s.durationMs).sort((a, b) => a - b), 0.95)
  const current = percentile(sorted.slice(middle).map((s) => s.durationMs).sort((a, b) => a - b), 0.95)
  const deltaPercent = previous === 0 ? 0 : ((current - previous) / previous) * 100
  return {
    currentMs: current,
    previousMs: previous,
    deltaPercent,
    direction: Math.abs(deltaPercent) < 5 ? 'flat' : deltaPercent > 0 ? 'up' : 'down',
  }
}

export function rankSlowSamples(samples: PerformanceSample[], limit = 8): PerformanceSample[] {
  return [...samples].sort((a, b) => b.durationMs - a.durationMs).slice(0, Math.max(0, limit))
}

// ===== 画布规模与链路统计 =====
// 画布样本统一在 params 里带 nodeCount / edgeCount / affectedCount / scaleLabel，
// 这里只做纯推导：分桶 → 每桶 P95 → 相邻桶增长率（规模敏感度）→ 链路瀑布。

export const SCALE_BUCKETS = [
  { id: 'lt200', label: '< 200 节点', min: 0, max: 200 },
  { id: '200-1k', label: '200 - 1k', min: 200, max: 1000 },
  { id: '1k-5k', label: '1k - 5k', min: 1000, max: 5000 },
  { id: '5k-20k', label: '5k - 20k', min: 5000, max: 20000 },
  { id: '20k+', label: '20k+', min: 20000, max: Number.POSITIVE_INFINITY },
] as const

export type ScaleBucketId = typeof SCALE_BUCKETS[number]['id']

export const SCALE_BUCKET_LABELS: Record<ScaleBucketId | 'all', string> = {
  all: '全部规模',
  lt200: '< 200 节点',
  '200-1k': '200 - 1k 节点',
  '1k-5k': '1k - 5k 节点',
  '5k-20k': '5k - 20k 节点',
  '20k+': '20k+ 节点',
}

export function scaleBucketOf(nodeCount: number): ScaleBucketId {
  if (!Number.isFinite(nodeCount) || nodeCount < 0) return 'lt200'
  for (const bucket of SCALE_BUCKETS) {
    if (nodeCount >= bucket.min && nodeCount < bucket.max) return bucket.id
  }
  return '20k+'
}

export interface SampleScale {
  nodeCount: number
  edgeCount: number
  affectedCount: number
  hiddenCount: number
  scaleLabel: string
  operation: string
}

function numericParam(params: Record<string, unknown>, key: string): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function readSampleScale(sample: PerformanceSample): SampleScale {
  const params = sample.params ?? {}
  const nodeCount = numericParam(params, 'nodeCount')
  const edgeCount = numericParam(params, 'edgeCount')
  const affectedCount = Math.max(1, numericParam(params, 'affectedCount') || 1)
  const hiddenCount = numericParam(params, 'hiddenCount')
  const operation = typeof params.operation === 'string' ? params.operation : ''
  const scaleLabel = typeof params.scaleLabel === 'string' && params.scaleLabel
    ? params.scaleLabel
    : nodeCount > 0 ? `${nodeCount} 节点 · 影响 ${affectedCount}` : ''
  return { nodeCount, edgeCount, affectedCount, hiddenCount, scaleLabel, operation }
}

/** 每个受影响节点的平均耗时，让「移动 1 个节点」与「移动 200 个节点」可横向比较。 */
export function perUnitMs(sample: PerformanceSample): number {
  return Math.round((sample.durationMs / readSampleScale(sample).affectedCount) * 100) / 100
}

export interface ScaleBucketStatistics {
  bucket: ScaleBucketId
  label: string
  count: number
  slowCount: number
  slowRate: number
  p50Ms: number
  p95Ms: number
  avgPerUnitMs: number
}

export function computeScaleStatistics(samples: PerformanceSample[]): ScaleBucketStatistics[] {
  const groups = new Map<ScaleBucketId, PerformanceSample[]>()
  for (const sample of samples) {
    const nodeCount = readSampleScale(sample).nodeCount
    if (nodeCount <= 0) continue
    const bucket = scaleBucketOf(nodeCount)
    const group = groups.get(bucket)
    if (group) group.push(sample)
    else groups.set(bucket, [sample])
  }
  return SCALE_BUCKETS.map((bucket) => {
    const group = groups.get(bucket.id) ?? []
    const durations = group.map((sample) => sample.durationMs).sort((a, b) => a - b)
    const slowCount = group.filter(isSlowSample).length
    return {
      bucket: bucket.id,
      label: bucket.label,
      count: group.length,
      slowCount,
      slowRate: rate(slowCount, group.length),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      avgPerUnitMs: average(group.map(perUnitMs)),
    }
  })
}

export interface ScaleSensitivity {
  key: string
  label: string
  buckets: Array<{ bucket: ScaleBucketId; label: string; p95Ms: number; count: number }>
  maxGrowthPercent: number
  scaleSensitive: boolean
}

/** 相邻非空规模桶的 P95 增长率；斜率大 = 该操作随节点数劣化，优先排查。 */
export function computeScaleSensitivity(
  samples: PerformanceSample[],
  groupBy: 'operation' | 'metric' = 'operation',
): ScaleSensitivity[] {
  const grouped = new Map<string, PerformanceSample[]>()
  for (const sample of samples) {
    const scale = readSampleScale(sample)
    if (scale.nodeCount <= 0) continue
    const key = groupBy === 'operation' ? (scale.operation || sample.metric) : sample.metric
    const group = grouped.get(key)
    if (group) group.push(sample)
    else grouped.set(key, [sample])
  }
  return Array.from(grouped.entries()).map(([key, group]) => {
    const buckets = SCALE_BUCKETS.map((bucket) => {
      const members = group.filter((sample) => scaleBucketOf(readSampleScale(sample).nodeCount) === bucket.id)
      const durations = members.map((sample) => sample.durationMs).sort((a, b) => a - b)
      return {
        bucket: bucket.id,
        label: bucket.label,
        p95Ms: percentile(durations, 0.95),
        count: members.length,
      }
    })
    const filled = buckets.filter((bucket) => bucket.count > 0)
    let maxGrowthPercent = 0
    for (let index = 1; index < filled.length; index += 1) {
      const previous = filled[index - 1].p95Ms
      if (previous > 0) {
        maxGrowthPercent = Math.max(maxGrowthPercent, ((filled[index].p95Ms - previous) / previous) * 100)
      }
    }
    maxGrowthPercent = Math.round(maxGrowthPercent * 10) / 10
    return {
      key,
      label: groupBy === 'operation'
        ? (CANVAS_OPERATION_LABELS[key as keyof typeof CANVAS_OPERATION_LABELS] ?? key)
        : key,
      buckets,
      maxGrowthPercent,
      scaleSensitive: filled.length >= 2 && maxGrowthPercent >= 50,
    }
  }).sort((a, b) => b.maxGrowthPercent - a.maxGrowthPercent)
}

export interface OperationStatistics {
  operation: string
  label: string
  count: number
  slowCount: number
  failCount: number
  p50Ms: number
  p95Ms: number
  avgPerUnitMs: number
  scaleSensitive: boolean
}

export function computeOperationStatistics(samples: PerformanceSample[]): OperationStatistics[] {
  const grouped = new Map<string, PerformanceSample[]>()
  for (const sample of samples) {
    const operation = readSampleScale(sample).operation
    if (!operation) continue
    const group = grouped.get(operation)
    if (group) group.push(sample)
    else grouped.set(operation, [sample])
  }
  const sensitivity = new Map(
    computeScaleSensitivity(samples, 'operation').map((item) => [item.key, item.scaleSensitive]),
  )
  return Array.from(grouped.entries()).map(([operation, group]) => {
    const durations = group.map((sample) => sample.durationMs).sort((a, b) => a - b)
    return {
      operation,
      label: CANVAS_OPERATION_LABELS[operation as keyof typeof CANVAS_OPERATION_LABELS] ?? operation,
      count: group.length,
      slowCount: group.filter(isSlowSample).length,
      failCount: group.filter((sample) => !sample.success).length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      avgPerUnitMs: average(group.map(perUnitMs)),
      scaleSensitive: sensitivity.get(operation) ?? false,
    }
  }).sort((a, b) => b.p95Ms - a.p95Ms)
}

export interface TraceSpan {
  id: string
  metric: string
  label: string
  operation: string
  durationMs: number
  offsetMs: number
  success: boolean
  scaleLabel: string
}

export interface TraceGroup {
  traceId: string
  contextKey: string
  startMs: number
  totalMs: number
  slow: boolean
  spans: TraceSpan[]
}

/**
 * 把同一次用户操作的主样本与后台子样本串成瀑布。
 * 全量构建 / 写盘在存储层上报，拿不到主链路 traceId，按同房间 + 时间窗归并。
 */
export function groupByTrace(samples: PerformanceSample[], windowMs = 2000): TraceGroup[] {
  const groups = new Map<string, PerformanceSample[]>()
  const orphans: PerformanceSample[] = []
  for (const sample of samples) {
    if (sample.traceId) {
      const group = groups.get(sample.traceId)
      if (group) group.push(sample)
      else groups.set(sample.traceId, [sample])
    } else {
      orphans.push(sample)
    }
  }
  for (const orphan of orphans) {
    const contextKey = typeof orphan.params?.contextKey === 'string' ? orphan.params.contextKey : ''
    let bestKey: string | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const [traceId, group] of groups) {
      const anchor = group[0]
      const anchorContext = typeof anchor.params?.contextKey === 'string' ? anchor.params.contextKey : ''
      if (contextKey && anchorContext && contextKey !== anchorContext) continue
      const distance = Math.abs(orphan.timestampMs - anchor.timestampMs)
      if (distance <= windowMs && distance < bestDistance) {
        bestDistance = distance
        bestKey = traceId
      }
    }
    if (bestKey) groups.get(bestKey)!.push(orphan)
  }
  return Array.from(groups.entries()).map(([traceId, group]) => {
    const sorted = [...group].sort((a, b) => a.timestampMs - b.timestampMs)
    const startMs = sorted[0].timestampMs
    const spans: TraceSpan[] = sorted.map((sample) => ({
      id: sample.id,
      metric: sample.metric,
      label: sample.label,
      operation: readSampleScale(sample).operation,
      durationMs: sample.durationMs,
      offsetMs: sample.timestampMs - startMs,
      success: sample.success,
      scaleLabel: readSampleScale(sample).scaleLabel,
    }))
    return {
      traceId,
      contextKey: typeof sorted[0].params?.contextKey === 'string' ? sorted[0].params.contextKey : '',
      startMs,
      totalMs: spans.reduce((max, span) => Math.max(max, span.offsetMs + span.durationMs), 0),
      slow: group.some(isSlowSample),
      spans,
    }
  }).sort((a, b) => b.startMs - a.startMs)
}

// ===== 规模阈值标定 =====
// 动态阈值 thresholdForScale 只在埋点时写进 params.thresholdMs，统计层不需要知道
// 它怎么算的；这里反过来用「样本里实际生效的阈值」评估标定效果：按动作 × 规模桶
// 看慢率与 P95/阈值比，指出哪些组合过紧（全标红）或过松（永远抓不到慢操作），
// 并给出建议放宽倍数。纯函数，可被回归脚本 esbuild 真跑，也是标定脚本的算法核心。

export type CalibrationVerdict = 'insufficient' | 'too_tight' | 'healthy' | 'too_loose'

/** 少于该样本数的分组不下结论，避免用一两条样本去改阈值。 */
export const CALIBRATION_MIN_SAMPLES = 5
/** 慢率高于此值且 P95 已越线 → 阈值过紧，慢样本失去区分度。 */
export const CALIBRATION_TIGHT_SLOW_RATE = 30
/** 零慢样本且 P95 不到阈值这个比例 → 阈值过松，抓不到慢操作。 */
export const CALIBRATION_LOOSE_RATIO = 0.5

export const CALIBRATION_VERDICT_LABELS: Record<CalibrationVerdict, string> = {
  insufficient: '样本不足',
  too_tight: '阈值过紧',
  healthy: '标定合理',
  too_loose: '阈值过松',
}

export interface ScaleCalibrationRow {
  operation: string
  label: string
  bucket: ScaleBucketId
  bucketLabel: string
  count: number
  /** 成功样本数；失败样本单独计，不参与分位数与慢率分母。 */
  successCount: number
  p50Ms: number
  p95Ms: number
  /** 契约里的静态阈值（未做规模放宽）。 */
  baseThresholdMs: number
  /** 该组样本实际生效阈值的中位数（埋点已按规模放宽）。 */
  effectiveThresholdMs: number
  /** effective / base，即当前实际放宽倍数。 */
  appliedFactor: number
  slowCount: number
  slowRate: number
  /** P95 / 生效阈值；> 1 表示尾部已越过阈值。 */
  p95ToThresholdRatio: number
  verdict: CalibrationVerdict
  /** 建议把 appliedFactor 调整到多少；仅作为调参参考，不自动改契约。 */
  suggestedFactor: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function computeScaleCalibration(
  samples: PerformanceSample[],
  minSamples = CALIBRATION_MIN_SAMPLES,
): ScaleCalibrationRow[] {
  const groups = new Map<string, PerformanceSample[]>()
  for (const sample of samples) {
    const scale = readSampleScale(sample)
    if (scale.nodeCount <= 0 || !scale.operation) continue
    const key = `${scale.operation}|${scaleBucketOf(scale.nodeCount)}`
    const group = groups.get(key)
    if (group) group.push(sample)
    else groups.set(key, [sample])
  }

  const bucketOrder = new Map<ScaleBucketId, number>(SCALE_BUCKETS.map((bucket, index) => [bucket.id, index]))
  const rows: ScaleCalibrationRow[] = []
  for (const [key, group] of groups) {
    const [operation, bucketId] = key.split('|') as [string, ScaleBucketId]
    // 失败样本的耗时是异常栈/超时值，混进 P95 会把阈值误判成「过紧」。
    const successful = group.filter((sample) => sample.success)
    const durations = successful.map((sample) => sample.durationMs).sort((a, b) => a - b)
    const thresholds = group.map((sample) => sample.thresholdMs).sort((a, b) => a - b)
    const effectiveThresholdMs = percentile(thresholds, 0.5)
    const contractBase = CANVAS_OPERATION_THRESHOLDS[operation as CanvasOperationId]
    const baseThresholdMs = typeof contractBase === 'number' && contractBase > 0
      ? contractBase
      : (effectiveThresholdMs > 0 ? effectiveThresholdMs : 1)
    const appliedFactor = round2(effectiveThresholdMs / baseThresholdMs)
    const p95Ms = percentile(durations, 0.95)
    const p95ToThresholdRatio = effectiveThresholdMs > 0 ? round2(p95Ms / effectiveThresholdMs) : 0
    const slowCount = group.filter(isSlowSample).length
    const slowRate = rate(slowCount, successful.length)

    let verdict: CalibrationVerdict
    let suggestedFactor = appliedFactor
    if (successful.length < minSamples) {
      verdict = 'insufficient'
    } else if (slowRate > CALIBRATION_TIGHT_SLOW_RATE && p95ToThresholdRatio > 1) {
      verdict = 'too_tight'
      suggestedFactor = round2(appliedFactor * clamp(p95ToThresholdRatio, 1, 2.5))
    } else if (slowCount === 0 && p95ToThresholdRatio < CALIBRATION_LOOSE_RATIO) {
      verdict = 'too_loose'
      suggestedFactor = round2(appliedFactor * clamp(p95ToThresholdRatio, 0.5, 1))
    } else {
      verdict = 'healthy'
    }

    rows.push({
      operation,
      label: CANVAS_OPERATION_LABELS[operation as CanvasOperationId] ?? operation,
      bucket: bucketId,
      bucketLabel: SCALE_BUCKET_LABELS[bucketId],
      count: group.length,
      successCount: successful.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms,
      baseThresholdMs,
      effectiveThresholdMs,
      appliedFactor,
      slowCount,
      slowRate: round2(slowRate),
      p95ToThresholdRatio,
      verdict,
      suggestedFactor,
    })
  }

  return rows.sort((a, b) =>
    (bucketOrder.get(a.bucket) ?? 0) - (bucketOrder.get(b.bucket) ?? 0)
    || b.slowRate - a.slowRate
    || a.operation.localeCompare(b.operation))
}

export interface CalibrationSummary {
  totalRows: number
  sampleCount: number
  healthy: number
  tooTight: number
  tooLoose: number
  insufficient: number
  /** 慢率最高的过紧组合，报告里作为首选调参对象。 */
  worst: ScaleCalibrationRow | null
}

export function computeCalibrationSummary(rows: ScaleCalibrationRow[]): CalibrationSummary {
  const tight = rows.filter((row) => row.verdict === 'too_tight')
  return {
    totalRows: rows.length,
    sampleCount: rows.reduce((sum, row) => sum + row.count, 0),
    healthy: rows.filter((row) => row.verdict === 'healthy').length,
    tooTight: tight.length,
    tooLoose: rows.filter((row) => row.verdict === 'too_loose').length,
    insufficient: rows.filter((row) => row.verdict === 'insufficient').length,
    worst: tight.reduce<ScaleCalibrationRow | null>((current, row) =>
      !current || row.slowRate > current.slowRate ? row : current, null),
  }
}
