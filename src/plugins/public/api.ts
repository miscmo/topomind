import type { ReactNode } from 'react'

import type { PerformanceCategoryId, PerformanceMetricId } from '@/shared/observability/performanceContract'
import type { Disposable } from './disposables'
import type { PluginManifest } from './manifest'

export type { PerformanceCategoryId, PerformanceMetricId }

export interface SecondaryViewRendererProps {
  viewId: string
  pluginId: string
}

export interface WidgetRendererProps {
  widgetId: string
  pluginId: string
}

export interface WorkspaceApi {
  getCurrentWorkspaceId(): string | null
  subscribeCurrentWorkspaceId(listener: (workspaceId: string | null) => void): Disposable
}

export interface ViewApi {
  register(definition: {
    viewId: string
    render: (props: SecondaryViewRendererProps) => ReactNode
  }): Disposable

  open(viewId: string): Promise<void>
}

export interface CommandApi {
  register(definition: {
    commandId: string
    execute: (args?: unknown) => void | Promise<void>
  }): Disposable

  execute(commandId: string, args?: unknown): Promise<void>
}

export interface UiApi {
  registerWidget(definition: {
    widgetId: string
    placement: 'titlebar' | 'home'
    render: (props: WidgetRendererProps) => ReactNode
  }): Disposable

  notify(input: { title: string; message?: string; level?: 'info' | 'warn' | 'error' }): void
}

export interface LoggingApi {
  info(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}

export type LearningPageType =
  | 'home'
  | 'kb'
  | 'graph'
  | 'document'
  | 'monitor'
  | 'statistics'
  | 'secondary-view'
  | 'setup'

export interface LearningSessionContextSnapshot {
  pageType: LearningPageType
  tabId?: string
  tabType?: string
  kbPath?: string
  roomPath?: string
  documentId?: string
  selectedNodeId?: string
  rightPanelTab?: string
}

export interface LearningSessionSnapshot {
  id: string
  startTime: number
  endTime: number
  duration: number
  context?: LearningSessionContextSnapshot
}

export interface LearningDailyRecord {
  date: string
  totalDuration: number
  sessions: LearningSessionSnapshot[]
}

export interface LearningStatsMetaSnapshot {
  version: '1.0'
  settings: {
    idleThreshold: number
    dailyGoal: number
  }
  summary: {
    totalDuration: number
    currentStreak: number
    longestStreak: number
    lastActiveDate: string
  }
}

export interface LearningStateSnapshot {
  isActive: boolean
  todayDuration: number
  currentSession: LearningSessionSnapshot | null
  meta: LearningStatsMetaSnapshot | null
}

export interface LearningApi {
  getState(): LearningStateSnapshot
  subscribeState(listener: (state: LearningStateSnapshot) => void): Disposable
  getMeta(workspaceId?: string | null): Promise<LearningStatsMetaSnapshot | null>
  getSummary(input: { workspaceId?: string | null; days: number }): Promise<Record<string, number>>
  getDailyRecord(input: { workspaceId?: string | null; date: string }): Promise<LearningDailyRecord | null>
  getDailyRecords(input: { workspaceId?: string | null; dates: string[] }): Promise<Record<string, LearningDailyRecord | null>>
}

// 日志字段 / 等级 / 查询参数的唯一真源：src/shared/observability/logContract.ts。
// 插件公共层只做 re-export，禁止再声明第二份结构（规范 §3.1）。
export type {
  LogLevel,
  LogQueryInput,
  LogEntry as LogEntrySnapshot,
} from '@/shared/observability/logContract'

import type { LogEntry, LogLevel, LogQueryInput } from '@/shared/observability/logContract'

export interface LogsApi {
  getBuffer(): Promise<LogEntry[]>
  getAvailableDates(): Promise<string[]>
  query(input?: LogQueryInput): Promise<LogEntry[]>
  subscribe(listener: (entry: LogEntry) => void): Disposable
  /** 导出指定日期的 JSONL；宿主未实现时返回空串。 */
  exportJsonl?(date?: string): Promise<string>
  /** P3：一键诊断包（JSON 字符串，主进程已二次脱敏）；旧宿主可不实现。 */
  exportBundle?(): Promise<string>
  /** 主进程唯一等级阈值（v3 P0 补的运行时入口）；旧宿主可不实现。 */
  getLevel?(): Promise<LogLevel>
  setLevel?(level: LogLevel): Promise<LogLevel>
  subscribeLevel?(listener: (level: LogLevel) => void): Disposable
}

export interface PerformanceMetricDefinition {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  /** 注册表演进后新增；宿主 mock / 旧插件可不提供，页面须自行兜底。 */
  category?: PerformanceCategoryId
  categoryLabel?: string
  description?: string
  sampleRate?: number
}

export interface PerformanceSample {
  id: string
  metric: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
  durationMs: number
  success: boolean
  timestamp: string
  timestampMs: number
  module?: string
  category?: PerformanceCategoryId
  sessionId?: string
  source?: string
  traceId?: string
  params: Record<string, unknown>
}

export interface PerformanceApi {
  getMetricDefinitions(): PerformanceMetricDefinition[]
  querySamples(input?: { date?: string | null }): Promise<PerformanceSample[]>
  subscribeSamples(listener: (sample: PerformanceSample) => void, input?: { date?: string | null }): Disposable
}

export type PluginActivationReasonSnapshot =
  | { type: 'app-ready' }
  | { type: 'workspace-ready' }
  | { type: 'command'; commandId: string }
  | { type: 'view'; viewId: string }

export type PluginStateSnapshot =
  | 'disabled'
  | 'discovered'
  | 'validated'
  | 'indexed'
  | 'waiting'
  | 'loaded'
  | 'activating'
  | 'running'
  | 'deactivated'
  | 'failed'

export interface PluginRuntimeRecordSnapshot {
  pluginId: string
  contributionType: 'view' | 'command' | 'widget' | 'analytics'
  contributionId: string
  status: 'pending' | 'bound' | 'failed'
  errorMessage?: string
}

export interface PluginDiagnosticsSnapshot {
  pluginId: string
  manifest: PluginManifest
  state: PluginStateSnapshot
  lastActivationReason?: PluginActivationReasonSnapshot
  lastErrorMessage?: string
  lastFailedAt?: string
  runtimeRecords: PluginRuntimeRecordSnapshot[]
}

export interface PluginsApi {
  listDiagnostics(): PluginDiagnosticsSnapshot[]
  getDiagnostics(pluginId: string): PluginDiagnosticsSnapshot | null
  subscribeDiagnostics(listener: (diagnostics: PluginDiagnosticsSnapshot[]) => void): Disposable
  retryActivation(pluginId: string): Promise<void>
}
