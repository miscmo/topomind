/**
 * 事件目录（v3）—— 全应用唯一的事件注册表。
 *
 * 目标不是再加一份清单，而是把 v2 已有的 LOG_ACTIONS（50+ 条）与
 * PERFORMANCE_METRICS（21 条）通过**适配器**归入同一目录，因此新增 action /
 * 指标时目录、UI 筛选器、中文标签、门禁规则会自动同步，不需要四处补字符串。
 *
 * 每条事件定义：id / category / label / level / module / retentionDays /
 * sampleRate / description / example / owner。由 scripts/gen-event-types.mts
 * 生成 TS 类型与主进程 JS 产物（electron 无法 import TS，禁止手写副本）。
 *
 * 「未登记直接失败」：门禁 C9 会调用 validateEventCatalog()，任何漏登记、
 * 分类越界、保留期不一致都会让 verify:logging 失败，而不是运行时才记 WARN。
 */
import {
  LOG_ACTION_SPECS,
  LOG_CATEGORIES,
  LOG_CATEGORY_IDS,
  CATEGORY_RETENTION_DAYS,
  categoryFromLegacy,
  isLogCategory,
  type LogActionSpec,
  type LogCategory,
  type LogEntry,
  type LogLevel,
  type LogModuleId,
  type LogFactKind,
  type FactCardinality,
  type FactOwner,
} from './logContract.ts'
import {
  PERFORMANCE_METRIC_SPECS,
  PERFORMANCE_ACTION,
  type PerformanceMetricSpec,
} from './performanceContract.ts'

export interface EventSpec {
  id: string
  category: LogCategory
  label: string
  level: LogLevel
  module: LogModuleId
  retentionDays: number
  /** (0,1]；性能事件沿用指标的 sampleRate，其余为 1（全量）。 */
  sampleRate: number
  description: string
  example: string
  owner: 'action-registry' | 'performance-registry'
  /** 落盘时使用的 action id；性能事件全部复用保留 action `性能:记录`。 */
  action: string
  /** P7 M2：事实类型 / 基数 / 归属层，供覆盖率表与唯一性门禁核对。 */
  kind: LogFactKind
  cardinality: FactCardinality
  factOwner: FactOwner
}

function adaptAction(spec: LogActionSpec): EventSpec {
  const category = categoryFromLegacy({ level: spec.level, action: spec.id, module: spec.module })
  return {
    id: spec.id,
    category,
    label: spec.label,
    level: spec.level,
    module: spec.module,
    retentionDays: CATEGORY_RETENTION_DAYS[category],
    sampleRate: 1,
    description: spec.description,
    example: `${spec.id} · ${spec.label}`,
    owner: 'action-registry',
    action: spec.id,
    kind: spec.kind,
    cardinality: spec.cardinality,
    factOwner: spec.factOwner,
  }
}

function adaptMetric(spec: PerformanceMetricSpec): EventSpec {
  return {
    id: `perf.${spec.id}`,
    category: 'performance',
    label: `性能 · ${spec.label}`,
    level: 'INFO',
    module: 'performance',
    retentionDays: CATEGORY_RETENTION_DAYS.performance,
    sampleRate: spec.sampleRate,
    description: spec.description,
    example: `${PERFORMANCE_ACTION} · ${spec.id}`,
    owner: 'performance-registry',
    action: PERFORMANCE_ACTION,
    kind: 'metric',
    cardinality: 'per-event',
    factOwner: 'metric',
  }
}

/** 单一注册表：action 事件 + 指标事件，id 全局唯一。 */
export const EVENT_CATALOG: readonly EventSpec[] = [
  ...LOG_ACTION_SPECS.map(adaptAction),
  ...PERFORMANCE_METRIC_SPECS.map(adaptMetric),
]

export const EVENT_IDS: readonly string[] = EVENT_CATALOG.map((spec) => spec.id)

const EVENT_BY_ID = new Map<string, EventSpec>(EVENT_CATALOG.map((spec) => [spec.id, spec]))

export function getEventSpec(id: string): EventSpec | undefined {
  return EVENT_BY_ID.get(id)
}

/** action id → category，写入主进程 JS 产物，保证两端口径一致。 */
export const CATEGORY_BY_ACTION: Readonly<Record<string, LogCategory>> = Object.freeze(
  Object.fromEntries(LOG_ACTION_SPECS.map((spec) => [spec.id, categoryFromLegacy({
    level: spec.level, action: spec.id, module: spec.module,
  })])),
)

/** action id → 中文 label，供主进程为 v1/v2 老日志读时补齐 label。 */
export const ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(LOG_ACTION_SPECS.map((spec) => [spec.id, spec.label])),
)

/** UI 类别筛选器由目录自动生成，不手写枚举。 */
export function listCategoryFilters(): Array<{
  id: LogCategory
  label: string
  shortLabel: string
  retentionDays: number
  description: string
  eventCount: number
}> {
  return LOG_CATEGORY_IDS.map((id) => ({
    id,
    label: LOG_CATEGORIES[id].label,
    shortLabel: LOG_CATEGORIES[id].shortLabel,
    retentionDays: CATEGORY_RETENTION_DAYS[id],
    description: LOG_CATEGORIES[id].description,
    eventCount: EVENT_CATALOG.filter((spec) => spec.category === id).length,
  }))
}

/** 读时兼容入口：查询、订阅、UI 都用它给老日志补 category。 */
export function categoryForEntry(entry: Partial<LogEntry> | null | undefined): LogCategory {
  return categoryFromLegacy(entry)
}

/**
 * 目录自检：返回问题列表（空数组表示健康）。由生成脚本与门禁 C9 调用，
 * 漏登记 / 重复 / 分类越界 / 保留期不一致都不再只是运行时 WARN。
 */
export function validateEventCatalog(): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const spec of EVENT_CATALOG) {
    if (seen.has(spec.id)) problems.push(`重复事件 id: ${spec.id}`)
    seen.add(spec.id)
    if (!isLogCategory(spec.category)) problems.push(`${spec.id} 分类非法: ${String(spec.category)}`)
    if (spec.retentionDays !== CATEGORY_RETENTION_DAYS[spec.category]) {
      problems.push(`${spec.id} 保留期与类别不一致`)
    }
    if (!(spec.sampleRate > 0 && spec.sampleRate <= 1)) problems.push(`${spec.id} sampleRate 越界`)
    if (!spec.label || !spec.description || !spec.example) problems.push(`${spec.id} 缺少可读性元数据`)
    if (!['intent', 'state', 'process', 'periodic', 'failure', 'metric'].includes(spec.kind)) {
      problems.push(`${spec.id} 缺少合法事实类型 kind`)
    }
    if (!['per-interaction', 'per-state-change', 'per-event'].includes(spec.cardinality)) {
      problems.push(`${spec.id} 缺少合法事实基数 cardinality`)
    }
  }
  for (const action of LOG_ACTION_SPECS) {
    if (!seen.has(action.id)) problems.push(`LOG_ACTIONS 未登记到事件目录: ${action.id}`)
    if (!CATEGORY_BY_ACTION[action.id]) problems.push(`LOG_ACTIONS 缺少分类映射: ${action.id}`)
  }
  for (const metric of PERFORMANCE_METRIC_SPECS) {
    if (!seen.has(`perf.${metric.id}`)) problems.push(`性能指标未登记到事件目录: ${metric.id}`)
  }
  return problems
}
