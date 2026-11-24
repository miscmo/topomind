import { bootstrapCommandRegistry } from '@/application/commands'
import { FSB } from '@/core/fs-backend'
import {
  logExportBundle,
  logExportJsonl,
  logGetAvailableDates,
  logGetBuffer,
  logGetLevel,
  logQueryPage,
  logSetLevel,
  logSubscribe,
  logSubscribeLevel,
  logUnsubscribe,
} from '@/core/log-backend'
import { writeEntry } from '@/core/logger'
import { useLearningTrackerStore } from '@/features/learning-tracker/model/learningTrackerStore'
import { LOG_LIMITS, logDayKey, type LogEntry, type LogQueryInput } from '@/shared/observability/logContract'
import { PERFORMANCE_METRIC_DEFINITIONS, extractPerformanceSamples } from '@/shared/observability/performanceMetrics'
import { PluginManager } from './host/pluginManager'
import type { PluginDiagnostics as HostPluginDiagnostics, RuntimeBindingRecord } from './host/pluginTypes'
import { getDefaultSecondaryViewTabId, getLegacySecondaryView } from './secondaryViews'
import type { LearningDailyRecord, LearningSessionContextSnapshot, LearningSessionSnapshot, LearningStateSnapshot, LearningStatsMetaSnapshot, PerformanceMetricDefinition, PerformanceSample, PluginDiagnosticsSnapshot, PluginRuntimeRecordSnapshot } from './public/api'
import { normalizeLogEntry } from './public/monitorStore'
import { useTabStore } from '@/stores/tabs/tabStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

/**
 * 分页拉全量：主进程单次最多返回 LOG_LIMITS.maxQueryLimit(500) 条。
 * v3 P4：上限从 50 页(2.5 万)提到 200 页(10 万)，覆盖「当日 10 万条」验收场景；
 * 主进程查询计划缓存让后续页只做内存 slice + 按偏移随机读，不再逐页全量解析。
 */
async function queryAllLogs(opts: LogQueryInput): Promise<LogEntry[]> {
  const pageSize = LOG_LIMITS.maxQueryLimit
  const collected: LogEntry[] = []
  let offset = 0
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await logQueryPage({ ...opts, limit: pageSize, offset })
    collected.push(...page.entries)
    offset += page.entries.length
    if (page.entries.length === 0 || offset >= page.total) break
  }
  return collected
}

let pluginManagerSingleton: PluginManager | null = null

function toDisposable(dispose: () => void) {
  return { dispose }
}

function resolveWorkspaceId(explicitWorkspaceId?: string | null): string | null {
  return explicitWorkspaceId ?? useWorkspaceStore.getState().currentWorkDir
}

function cloneLearningSessionContext(context?: LearningSessionSnapshot['context'] | null): LearningSessionContextSnapshot | undefined {
  if (!context) {
    return undefined
  }

  return {
    pageType: context.pageType,
    tabId: context.tabId,
    tabType: context.tabType,
    kbPath: context.kbPath,
    roomPath: context.roomPath,
    documentId: context.documentId,
    selectedNodeId: context.selectedNodeId,
    rightPanelTab: context.rightPanelTab,
  }
}

function cloneLearningSession(session: LearningSessionSnapshot | null | undefined): LearningSessionSnapshot | null {
  if (!session) {
    return null
  }

  return {
    id: session.id,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    context: cloneLearningSessionContext(session.context),
  }
}

function cloneLearningMeta(meta: LearningStatsMetaSnapshot | null | undefined): LearningStatsMetaSnapshot | null {
  if (!meta) {
    return null
  }

  return {
    version: '1.0',
    settings: {
      idleThreshold: meta.settings?.idleThreshold ?? 180,
      dailyGoal: meta.settings?.dailyGoal ?? 3600 * 2,
    },
    summary: {
      totalDuration: meta.summary?.totalDuration ?? 0,
      currentStreak: meta.summary?.currentStreak ?? 0,
      longestStreak: meta.summary?.longestStreak ?? 0,
      lastActiveDate: meta.summary?.lastActiveDate ?? '',
    },
  }
}

function getLearningStateSnapshot(): LearningStateSnapshot {
  const state = useLearningTrackerStore.getState()
  return {
    isActive: state.isActive,
    todayDuration: state.todayDuration,
    currentSession: cloneLearningSession(state.currentSession),
    meta: cloneLearningMeta(state.meta),
  }
}

function cloneLearningDailyRecord(record: unknown): LearningDailyRecord | null {
  if (!record || typeof record !== 'object') {
    return null
  }

  const raw = record as Partial<LearningDailyRecord>
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.map((session) => cloneLearningSession(session)!).filter(Boolean) : []
  return {
    date: typeof raw.date === 'string' ? raw.date : '',
    totalDuration: typeof raw.totalDuration === 'number' ? raw.totalDuration : 0,
    sessions,
  }
}

function cloneRuntimeRecord(record: RuntimeBindingRecord): PluginRuntimeRecordSnapshot {
  return {
    pluginId: record.pluginId,
    contributionType: record.contributionType,
    contributionId: record.contributionId,
    status: record.status,
    errorMessage: record.errorMessage,
  }
}

function clonePluginDiagnostics(diagnostics: HostPluginDiagnostics): PluginDiagnosticsSnapshot {
  return {
    pluginId: diagnostics.pluginId,
    manifest: { ...diagnostics.manifest },
    state: diagnostics.state,
    lastActivationReason: diagnostics.lastActivationReason ? { ...diagnostics.lastActivationReason } : undefined,
    lastErrorMessage: diagnostics.lastErrorMessage,
    lastFailedAt: diagnostics.lastFailedAt,
    runtimeRecords: diagnostics.runtimeRecords.map(cloneRuntimeRecord),
  }
}

function getPerformanceMetricDefinitions(): PerformanceMetricDefinition[] {
  return Object.values(PERFORMANCE_METRIC_DEFINITIONS).map((definition) => ({ ...definition }))
}

export function getPluginManager(): PluginManager {
  if (!pluginManagerSingleton) {
    const commandRegistry = bootstrapCommandRegistry()
    pluginManagerSingleton = new PluginManager({
      hostServices: {
        getCurrentWorkspaceId() {
          return useWorkspaceStore.getState().currentWorkDir
        },
        subscribeCurrentWorkspaceId(listener) {
          let previousWorkspaceId = useWorkspaceStore.getState().currentWorkDir
          const unsubscribe = useWorkspaceStore.subscribe((state) => {
            if (state.currentWorkDir === previousWorkspaceId) {
              return
            }
            previousWorkspaceId = state.currentWorkDir
            listener(previousWorkspaceId)
          })
          return toDisposable(unsubscribe)
        },
        getLearningState() {
          return getLearningStateSnapshot()
        },
        subscribeLearningState(listener) {
          const unsubscribe = useLearningTrackerStore.subscribe(() => {
            listener(getLearningStateSnapshot())
          })
          return toDisposable(unsubscribe)
        },
        async getLearningMeta(workspaceId) {
          const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
          if (!resolvedWorkspaceId) {
            return null
          }
          return cloneLearningMeta(await FSB.readLearningStatsData(resolvedWorkspaceId) as LearningStatsMetaSnapshot | null)
        },
        async getLearningSummary(workspaceId, days) {
          const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
          if (!resolvedWorkspaceId) {
            return {}
          }
          return FSB.readLearningStatsSummary(resolvedWorkspaceId, days)
        },
        async getLearningDailyRecord(workspaceId, date) {
          const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
          if (!resolvedWorkspaceId) {
            return null
          }
          return cloneLearningDailyRecord(await FSB.readLearningStatsData(resolvedWorkspaceId, date))
        },
        async getLearningDailyRecords(workspaceId, dates) {
          const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
          if (!resolvedWorkspaceId) {
            return {}
          }

          const records = await Promise.all(
            dates.map(async (date) => [date, cloneLearningDailyRecord(await FSB.readLearningStatsData(resolvedWorkspaceId, date))] as const),
          )
          return Object.fromEntries(records)
        },
        async getLogBuffer() {
          return (await logGetBuffer()).map(normalizeLogEntry)
        },
        async getLogAvailableDates() {
          return logGetAvailableDates()
        },
        async queryLogs(input) {
          // v3 P4：完整下推查询条件。此前 categories / sessionId 被丢弃，
          // 导致 UI 选了类别或会话仍扫描全部物理分片、拉回全量条目。
          return (await queryAllLogs({
            date: input?.date,
            keyword: input?.keyword,
            levels: input?.levels,
            actions: input?.actions,
            categories: input?.categories,
            sessionId: input?.sessionId,
            traceId: input?.traceId,
            startTime: input?.startTime,
            endTime: input?.endTime,
            limit: input?.limit,
            offset: input?.offset,
          })).map(normalizeLogEntry)
        },
        async exportJsonl(date) {
          return logExportJsonl(date ?? undefined)
        },
        // P3：一键诊断包，主进程负责二次脱敏与双目录汇总。
        async exportBundle() {
          return logExportBundle()
        },
        // v3 P0：把主进程唯一等级阈值接到插件 API，监控页可直接查看/切换。
        async getLogLevel() {
          return logGetLevel()
        },
        async setLogLevel(level) {
          return logSetLevel(level)
        },
        subscribeLogLevel(listener) {
          return toDisposable(logSubscribeLevel(listener))
        },
        subscribeLogs(listener) {
          const handleEntry = (entry: unknown) => {
            listener(normalizeLogEntry(entry as LogEntry))
          }
          logSubscribe(handleEntry)
          return toDisposable(() => {
            logUnsubscribe(handleEntry)
          })
        },
        getPerformanceMetricDefinitions() {
          return getPerformanceMetricDefinitions()
        },
        async queryPerformanceSamples(input) {
          const entries = await queryAllLogs({ date: input?.date ?? undefined })
          return extractPerformanceSamples(entries.map(normalizeLogEntry)) as PerformanceSample[]
        },
        subscribePerformanceSamples(listener, input) {
          const handleEntry = (entry: unknown) => {
            const samples = extractPerformanceSamples([normalizeLogEntry(entry as LogEntry)]) as PerformanceSample[]
            for (const sample of samples) {
              if (input?.date && logDayKey(sample.timestamp) !== input.date) {
                continue
              }
              listener(sample)
            }
          }
          logSubscribe(handleEntry)
          return toDisposable(() => {
            logUnsubscribe(handleEntry)
          })
        },
        listPluginDiagnostics() {
          return pluginManagerSingleton?.listPluginDiagnostics().map(clonePluginDiagnostics) ?? []
        },
        getPluginDiagnostics(pluginId) {
          const diagnostics = pluginManagerSingleton?.getPluginDiagnostics(pluginId)
          return diagnostics ? clonePluginDiagnostics(diagnostics) : null
        },
        subscribePluginDiagnostics(listener) {
          const manager = pluginManagerSingleton
          if (!manager) {
            return toDisposable(() => {})
          }

          return manager.subscribeDiagnostics((diagnostics) => {
            listener(diagnostics.map(clonePluginDiagnostics))
          })
        },
        async retryPluginActivation(pluginId) {
          const manager = pluginManagerSingleton
          if (!manager) {
            throw new Error('Plugin manager is not initialized')
          }

          const diagnostics = manager.getPluginDiagnostics(pluginId)
          if (!diagnostics?.lastActivationReason) {
            throw new Error(`Plugin ${pluginId} has no activation reason to retry`)
          }

          await manager.ensureActivated(pluginId, diagnostics.lastActivationReason)
        },
        async openView(viewId) {
          const legacyTarget = getLegacySecondaryView(viewId)
          const staticView = pluginManagerSingleton?.getRegistry().getStaticView(viewId)

          if (!legacyTarget && !staticView) {
            throw new Error(`Unknown view: ${viewId}`)
          }

          const label =
            legacyTarget?.label ??
            (typeof staticView?.manifestData.title === 'string' ? staticView.manifestData.title : viewId)
          const tabId = legacyTarget?.tabId ?? getDefaultSecondaryViewTabId(viewId)

          useTabStore.getState().openSecondaryViewTab({
            viewId,
            label,
            tabId,
          })
        },
        async executeCommand(commandId, args) {
          await commandRegistry.execute(commandId, args)
        },
        // 插件 LoggingApi / notify 接回统一写入入口（Phase 0.4），不再只写 console。
        log(level, pluginId, message, details) {
          const context = details && typeof details === 'object' && !Array.isArray(details)
            ? details as Record<string, unknown>
            : { detail: details }
          void writeEntry({
            level: level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO',
            module: 'plugin',
            action: 'plugin.log',
            message: `[plugin:${pluginId}] ${message}`,
            params: { pluginId, ...context },
          })
        },
        notify(input) {
          void writeEntry({
            level: input.level === 'error' ? 'ERROR' : input.level === 'warn' ? 'WARN' : 'INFO',
            module: 'plugin',
            action: 'plugin.log',
            message: `[plugin-notify] ${input.title}`,
            params: { message: input.message ?? '' },
          })
        },
      },
    })

    commandRegistry.attachPluginBridge({
      execute(commandId, args) {
        if (!pluginManagerSingleton) {
          throw new Error('Plugin manager is not initialized')
        }

        return pluginManagerSingleton.executeCommand(commandId, args)
      },
      getStaticCommand(commandId) {
        return pluginManagerSingleton?.getRegistry().getStaticCommand(commandId)
      },
      listStaticCommands() {
        return pluginManagerSingleton?.getRegistry().listStaticCommands() ?? []
      },
    })
  }

  return pluginManagerSingleton
}

export function bootstrapPlugins(): PluginManager {
  const manager = getPluginManager()
  manager.discover()
  void manager.activateByReason({ type: 'app-ready' }).catch((error) => {
    void writeEntry({
      level: 'ERROR', module: 'plugin', action: 'plugin.log',
      message: '应用就绪插件激活失败', error,
    })
  })

  return manager
}
