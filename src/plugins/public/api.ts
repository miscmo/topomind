import type { ReactNode } from 'react'

import type { Disposable } from './disposables'
import type { PluginManifest } from './manifest'

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

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntrySnapshot {
  id?: string
  timestamp?: string
  level?: LogLevel
  module?: string
  file?: string
  line?: number
  func?: string
  action?: string
  message?: string
  params?: Record<string, unknown> | null
  traceId?: string | null
  spanId?: string | null
  parentId?: string | null
  meta?: Record<string, unknown> | null
}

export interface LogQueryInput {
  date?: string
  keyword?: string
  levels?: string[]
  actions?: string[]
  startTime?: string
  endTime?: string
}

export interface LogsApi {
  getBuffer(): Promise<LogEntrySnapshot[]>
  getAvailableDates(): Promise<string[]>
  query(input?: LogQueryInput): Promise<LogEntrySnapshot[]>
  subscribe(listener: (entry: LogEntrySnapshot) => void): Disposable
}

export type PerformanceMetricId =
  | 'room_load'
  | 'node_select'
  | 'detail_read'
  | 'detail_save'

export interface PerformanceMetricDefinition {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  color: string
  thresholdMs: number
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
