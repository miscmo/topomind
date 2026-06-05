import { bootstrapCommandRegistry } from '@/application/commands'
import { FSB } from '@/core/fs-backend'
import {
  logGetAvailableDates,
  logGetBuffer,
  logQuery,
  logSubscribe,
  logUnsubscribe,
} from '@/core/log-backend'
import { useLearningTrackerStore } from '@/features/learning-tracker/model/learningTrackerStore'
import { PERFORMANCE_METRIC_DEFINITIONS, extractPerformanceSamples } from '@/shared/observability/performanceMetrics'
import { PluginManager } from './host/pluginManager'
import type { PluginDiagnostics as HostPluginDiagnostics, RuntimeBindingRecord } from './host/pluginTypes'
import { getDefaultSecondaryViewTabId, getLegacySecondaryView } from './secondaryViews'
import type {
  LearningDailyRecord,
  LearningSessionContextSnapshot,
  LearningSessionSnapshot,
  LearningStateSnapshot,
  LearningStatsMetaSnapshot,
  LogEntrySnapshot,
  LogQueryInput,
  PerformanceMetricDefinition,
  PerformanceSample,
  PluginDiagnosticsSnapshot,
  PluginRuntimeRecordSnapshot,
} from './public/api'
import { useTabStore } from '@/stores/tabs/tabStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

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

function cloneLogEntry(entry: unknown): LogEntrySnapshot {
  const raw = (entry && typeof entry === 'object') ? entry as Partial<LogEntrySnapshot> : {}
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    level: raw.level,
    module: raw.module,
    file: raw.file,
    line: raw.line,
    func: raw.func,
    action: raw.action,
    message: raw.message,
    params: raw.params ?? null,
    traceId: raw.traceId ?? null,
    spanId: raw.spanId ?? null,
    parentId: raw.parentId ?? null,
    meta: raw.meta ?? null,
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

function toDateStr(iso: string): string {
  try {
    const date = new Date(iso)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  } catch {
    return ''
  }
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
          return (await logGetBuffer()).map(cloneLogEntry)
        },
        async getLogAvailableDates() {
          return logGetAvailableDates()
        },
        async queryLogs(input) {
          return (await logQuery({
            dateStr: input?.date,
            keyword: input?.keyword,
            levels: input?.levels,
            actions: input?.actions,
            startTime: input?.startTime,
            endTime: input?.endTime,
          })).map(cloneLogEntry)
        },
        subscribeLogs(listener) {
          const handleEntry = (entry: unknown) => {
            listener(cloneLogEntry(entry))
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
          const entries = await logQuery({
            dateStr: input?.date ?? undefined,
          })
          return extractPerformanceSamples(entries.map(cloneLogEntry)) as PerformanceSample[]
        },
        subscribePerformanceSamples(listener, input) {
          const handleEntry = (entry: unknown) => {
            const samples = extractPerformanceSamples([cloneLogEntry(entry)]) as PerformanceSample[]
            for (const sample of samples) {
              if (input?.date && toDateStr(sample.timestamp) !== input.date) {
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
        notify(input) {
          const prefix = `[plugin-notify] ${input.title}`

          if (input.level === 'error') {
            console.error(prefix, input.message)
            return
          }

          if (input.level === 'warn') {
            console.warn(prefix, input.message)
            return
          }

          console.info(prefix, input.message)
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
    console.error('Failed to activate app-ready plugins', error)
  })

  return manager
}
