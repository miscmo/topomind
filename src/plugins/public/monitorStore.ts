/**
 * 日志/性能监控窗口的全局状态（Zustand）
 *
 * 位置说明：这是「主应用 ↔ 内置 monitor 插件」共享的 UI 状态契约，放在
 * `plugins/public`（插件允许访问的公共层）而不是 `stores`：插件边界规则禁止
 * builtin 插件引用 `@/stores/*`。`core/session-reset.ts` 也直接引用本文件。
 *
 * ⚠️ 历史背景：本 store 曾同时存在两份完全相同的拷贝——
 * `features/monitor/model/monitorStore.ts` 与 `plugins/builtin/monitor/model/monitorStore.ts`，
 * 两者状态与 action 逐行一致，但只有 features 那份被 `core/session-reset.ts` 引用，
 * 造成 core 反向依赖 features 的分层倒置，且两份拷贝需要同步修改。
 * 现在只保留这一份，`features/monitor/`（1452 行死代码）已删除。
 */
import { create } from 'zustand'
import { LOG_LIMITS, categoryFromLegacy, type LogEntry } from '@/shared/observability/logContract'
import type { PluginDiagnosticsSnapshot as PluginDiagnostics } from './api'

// 唯一真源 re-export：禁止在这里重新声明 LogEntry（规范 §3.1）。
export type { LogEntry }

/**
 * 读时兼容（规范 §3.8 / v3 §2）：v1 没有 v 字段、error 藏在 params 里；
 * v2 没有 category / sessionId / seq。这里补齐 v3 关联键，只丢弃 v1 幽灵字段
 * file/line/func。spanId/parentId 自 v3 起是正式字段，必须保留。
 */
export function normalizeLogEntry(entry: LogEntry): LogEntry {
  const params = entry.params && typeof entry.params === 'object' ? entry.params : null
  const legacyError = params?.error
  let error = entry.error ?? null
  if (!error && legacyError !== undefined && legacyError !== null) {
    error = typeof legacyError === 'string'
      ? { name: 'Error', message: legacyError }
      : {
          name: String((legacyError as { name?: unknown }).name ?? 'Error'),
          message: String((legacyError as { message?: unknown }).message ?? ''),
        }
  }
  return {
    v: entry.v ?? 1,
    id: entry.id,
    timestamp: entry.timestamp ?? new Date(0).toISOString(),
    level: entry.level ?? 'INFO',
    module: entry.module,
    action: entry.action,
    label: entry.label,
    category: categoryFromLegacy(entry),
    sessionId: entry.sessionId,
    seq: entry.seq,
    spanId: entry.spanId,
    parentId: entry.parentId,
    workspaceId: entry.workspaceId,
    target: entry.target,
    result: entry.result,
    source: entry.source,
    outcome: entry.outcome,
    durationMs: entry.durationMs,
    message: entry.message ?? '',
    params,
    error,
    traceId: entry.traceId ?? null,
    meta: entry.meta ?? null,
    // P3 error 专属上下文：详情面板与后续「异常与崩溃」视图需要。
    fingerprint: entry.fingerprint,
    breadcrumbs: entry.breadcrumbs,
    dumpRef: entry.dumpRef,
    env: entry.env,
    // P7 事实唯一性：事实类型、内存步骤摘要与去重计数要能一路传到视图。
    kind: entry.kind,
    stepCount: entry.stepCount,
    steps: entry.steps,
    dedupeKey: entry.dedupeKey,
    repeatCount: entry.repeatCount,
  }
}

/**
 * v3 P4 视图集合：方案 §6 的五视图 + 保留「原始日志」作为排障底栏。
 * timeline 事件流 / spans 内部链路 / errors 异常与崩溃 / performance 性能 /
 * plugins 插件诊断 / log 原始日志（P1 起已有，不丢弃）。
 */
export type MonitorTab = 'timeline' | 'spans' | 'errors' | 'performance' | 'plugins' | 'log'

const MONITOR_INITIAL_STATE = {
  activeTab: 'timeline' as MonitorTab,
  keyword: '',
  selectedDate: null as string | null,
  availableDates: [] as string[],
  selectedLevels: [] as string[],
  /** v3 一级分类筛选；空数组表示全部。 */
  selectedCategories: [] as string[],
  entries: [] as LogEntry[],
  selectedEntry: null as LogEntry | null,
  streaming: true,
  /** v3 D3：详细模式只影响 UI 展开密度，不改变落盘的脱敏口径。 */
  detailed: false,
  /** 显示采样率：纯 UI 降采样，采集侧采样由事件目录 sampleRate 决定，不混为一谈。 */
  displaySampleRate: 1 as 1 | 0.5 | 0.1,
  /** session 选择：按会话回放，不按物理日志目录组织叙事（D5 补偿）。 */
  selectedSessionId: null as string | null,
  /** 跨视图联动：性能慢样本 / span 瀑布 / 事件流共用同一个 trace。 */
  selectedTraceId: null as string | null,
  /** 回放游标：null 表示非回放模式；数字表示当前停在事件流的第几条。 */
  replayCursor: null as number | null,
  stats: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
  pluginDiagnostics: [] as PluginDiagnostics[],
  selectedPluginId: null as string | null,
  loaded: false,
}

interface MonitorState {
  // 当前视图（v3 P4 五视图 + 原始日志）
  activeTab: MonitorTab
  setActiveTab: (tab: MonitorTab) => void
  /** 切换视图并携带联动 trace，供「性能慢样本 → 事件流」等跳转使用。 */
  focusTrace: (traceId: string) => void

  // 筛选条件
  keyword: string
  selectedDate: string | null  // YYYY-MM-DD
  availableDates: string[]
  selectedLevels: string[]  // ['DEBUG','INFO','WARN','ERROR']
  selectedCategories: string[]  // v3: ['user','internal','performance','error']

  setKeyword: (kw: string) => void
  setSelectedDate: (d: string | null) => void
  setAvailableDates: (dates: string[]) => void
  setSelectedLevels: (levels: string[]) => void
  setSelectedCategories: (categories: string[]) => void

  // 日志列表
  entries: LogEntry[]
  setEntries: (entries: LogEntry[]) => void
  appendEntries: (newEntries: LogEntry[]) => void

  // 选中的条目
  selectedEntry: LogEntry | null
  setSelectedEntry: (entry: LogEntry | null) => void

  // 实时流开关
  streaming: boolean
  setStreaming: (on: boolean) => void

  // v3 P4 统一控制条状态
  detailed: boolean
  setDetailed: (on: boolean) => void
  displaySampleRate: 1 | 0.5 | 0.1
  setDisplaySampleRate: (rate: 1 | 0.5 | 0.1) => void
  selectedSessionId: string | null
  setSelectedSessionId: (id: string | null) => void
  selectedTraceId: string | null
  setSelectedTraceId: (id: string | null) => void
  replayCursor: number | null
  setReplayCursor: (cursor: number | null) => void

  // 统计
  stats: {
    total: number
    debug: number
    info: number
    warn: number
    error: number
  }
  updateStats: () => void

  pluginDiagnostics: PluginDiagnostics[]
  selectedPluginId: string | null
  setPluginDiagnostics: (diagnostics: PluginDiagnostics[]) => void
  setSelectedPluginId: (pluginId: string | null) => void

  // 是否已加载
  loaded: boolean
  setLoaded: (v: boolean) => void
  reset: () => void
}

const EMPTY_STATS = { total: 0, debug: 0, info: 0, warn: 0, error: 0 }

export const useMonitorStore = create<MonitorState>((set, get) => ({
  ...MONITOR_INITIAL_STATE,

  setActiveTab: (tab) => set({ activeTab: tab, replayCursor: null }),
  focusTrace: (traceId) => set({ selectedTraceId: traceId, activeTab: 'timeline', replayCursor: null }),

  setKeyword: (keyword) => set({ keyword }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setAvailableDates: (availableDates) => set({ availableDates }),
  setSelectedLevels: (selectedLevels) => set({ selectedLevels }),
  setSelectedCategories: (selectedCategories) => set({ selectedCategories }),

  setEntries: (entries) => {
    set({ entries, loaded: true })
    get().updateStats()
  },

  appendEntries: (newEntries) => {
    const { entries } = get()
    // 按 id 去重，防止同一条日志通过 buffer 加载和 IPC 订阅两个路径重复添加
    const existingIds = new Set(entries.map((e) => e.id).filter(Boolean))
    const unique = newEntries.filter((n) => !n.id || !existingIds.has(n.id))
    // 与主进程环形缓冲统一为一个容量常量（契约 LOG_LIMITS）。
    const combined = [...entries, ...unique]
    const capacity = LOG_LIMITS.maxBufferSize
    const trimmed = combined.length > capacity ? combined.slice(-capacity) : combined
    set({ entries: trimmed })
    get().updateStats()
  },

  setSelectedEntry: (selectedEntry) => set({ selectedEntry }),

  setStreaming: (streaming) => set({ streaming }),
  setDetailed: (detailed) => set({ detailed }),
  setDisplaySampleRate: (displaySampleRate) => set({ displaySampleRate }),
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId, replayCursor: null }),
  setSelectedTraceId: (selectedTraceId) => set({ selectedTraceId }),
  setReplayCursor: (replayCursor) => set({ replayCursor }),

  updateStats: () => {
    const { entries } = get()
    const stats = { ...EMPTY_STATS }
    for (const e of entries) {
      const l = (e.level || 'INFO').toLowerCase()
      if (l === 'debug') stats.debug++
      else if (l === 'info') stats.info++
      else if (l === 'warn') stats.warn++
      else if (l === 'error') stats.error++
      stats.total++
    }
    set({ stats })
  },

  setPluginDiagnostics: (pluginDiagnostics) =>
    set((state) => {
      const selectedPluginId =
        state.selectedPluginId && pluginDiagnostics.some((item) => item.pluginId === state.selectedPluginId)
          ? state.selectedPluginId
          : pluginDiagnostics[0]?.pluginId ?? null

      return {
        pluginDiagnostics,
        selectedPluginId,
      }
    }),

  setSelectedPluginId: (selectedPluginId) => set({ selectedPluginId }),

  setLoaded: (loaded) => set({ loaded }),

  reset: () => set({ ...MONITOR_INITIAL_STATE, stats: { ...EMPTY_STATS } }),
}))
