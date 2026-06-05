import type {
  CommandApi,
  LearningApi,
  LearningDailyRecord,
  LearningStateSnapshot,
  LearningStatsMetaSnapshot,
  LoggingApi,
  LogEntrySnapshot,
  LogQueryInput,
  LogsApi,
  PerformanceApi,
  PerformanceMetricDefinition,
  PerformanceSample,
  PluginDiagnosticsSnapshot,
  PluginsApi,
  UiApi,
  ViewApi,
  WorkspaceApi,
} from '../public/api'
import type { ActivationReason, PluginContext } from '../public/plugin'
import type { PluginManifest, PluginPermission } from '../public/manifest'
import type { Disposable } from '../public/disposables'
import type { PluginRegistry } from './pluginRegistry'
import {
  API_PERMISSION_MAP,
  PluginPermissionError,
  requirePluginPermission,
} from './pluginPermissions.ts'

export interface PluginHostServices {
  getCurrentWorkspaceId(): string | null
  subscribeCurrentWorkspaceId(listener: (workspaceId: string | null) => void): Disposable
  getLearningState(): LearningStateSnapshot
  subscribeLearningState(listener: (state: LearningStateSnapshot) => void): Disposable
  getLearningMeta(workspaceId?: string | null): Promise<LearningStatsMetaSnapshot | null>
  getLearningSummary(workspaceId: string | null | undefined, days: number): Promise<Record<string, number>>
  getLearningDailyRecord(workspaceId: string | null | undefined, date: string): Promise<LearningDailyRecord | null>
  getLearningDailyRecords(workspaceId: string | null | undefined, dates: string[]): Promise<Record<string, LearningDailyRecord | null>>
  getLogBuffer(): Promise<LogEntrySnapshot[]>
  getLogAvailableDates(): Promise<string[]>
  queryLogs(input?: LogQueryInput): Promise<LogEntrySnapshot[]>
  subscribeLogs(listener: (entry: LogEntrySnapshot) => void): Disposable
  getPerformanceMetricDefinitions(): PerformanceMetricDefinition[]
  queryPerformanceSamples(input?: { date?: string | null }): Promise<PerformanceSample[]>
  subscribePerformanceSamples(listener: (sample: PerformanceSample) => void, input?: { date?: string | null }): Disposable
  listPluginDiagnostics(): PluginDiagnosticsSnapshot[]
  getPluginDiagnostics(pluginId: string): PluginDiagnosticsSnapshot | null
  subscribePluginDiagnostics(listener: (diagnostics: PluginDiagnosticsSnapshot[]) => void): Disposable
  retryPluginActivation(pluginId: string): Promise<void>
  openView(viewId: string): Promise<void>
  executeCommand(commandId: string, args?: unknown): Promise<void>
  notify(input: { title: string; message?: string; level?: 'info' | 'warn' | 'error' }): void
  log(level: 'info' | 'warn' | 'error', pluginId: string, message: string, details?: unknown): void
}

const defaultHostServices: PluginHostServices = {
  getCurrentWorkspaceId() {
    return null
  },
  subscribeCurrentWorkspaceId() {
    return { dispose() {} }
  },
  getLearningState() {
    return {
      isActive: false,
      todayDuration: 0,
      currentSession: null,
      meta: null,
    }
  },
  subscribeLearningState() {
    return { dispose() {} }
  },
  async getLearningMeta() {
    return null
  },
  async getLearningSummary() {
    return {}
  },
  async getLearningDailyRecord() {
    return null
  },
  async getLearningDailyRecords() {
    return {}
  },
  async getLogBuffer() {
    return []
  },
  async getLogAvailableDates() {
    return []
  },
  async queryLogs() {
    return []
  },
  subscribeLogs() {
    return { dispose() {} }
  },
  getPerformanceMetricDefinitions() {
    return []
  },
  async queryPerformanceSamples() {
    return []
  },
  subscribePerformanceSamples() {
    return { dispose() {} }
  },
  listPluginDiagnostics() {
    return []
  },
  getPluginDiagnostics() {
    return null
  },
  subscribePluginDiagnostics() {
    return { dispose() {} }
  },
  async retryPluginActivation(pluginId) {
    throw new Error(`retryPluginActivation() host service is not configured for plugin: ${pluginId}`)
  },
  async openView() {
    throw new Error('openView() host service is not configured')
  },
  async executeCommand() {
    throw new Error('executeCommand() host service is not configured')
  },
  notify() {
    // Default notification sink keeps development builds quiet when no host adapter is wired.
  },
  log(level, pluginId, message, details) {
    const prefix = `[plugin:${pluginId}] ${message}`

    if (level === 'error') {
      console.error(prefix, details)
      return
    }

    if (level === 'warn') {
      console.warn(prefix, details)
      return
    }

    console.info(prefix, details)
  },
}

function reportPermissionError(
  hostServices: PluginHostServices,
  manifest: PluginManifest,
  error: PluginPermissionError,
): never {
  hostServices.log('warn', manifest.id, error.message, {
    permission: error.permission,
    apiMethod: error.apiMethod,
  })
  throw error
}

function assertPermission(
  hostServices: PluginHostServices,
  manifest: PluginManifest,
  permission: PluginPermission,
  apiMethod: keyof typeof API_PERMISSION_MAP,
): void {
  try {
    requirePluginPermission(manifest, permission, apiMethod)
  } catch (error) {
    if (error instanceof PluginPermissionError) {
      reportPermissionError(hostServices, manifest, error)
    }

    throw error
  }
}

function reportBindingFailure(
  registry: PluginRegistry,
  manifest: PluginManifest,
  contributionType: 'view' | 'command' | 'widget',
  contributionId: string,
  error: unknown,
): never {
  registry.markBindingFailed(manifest.id, contributionType, contributionId, error)
  throw error
}

export function createPluginContext(input: {
  manifest: PluginManifest
  activationReason: ActivationReason
  registry: PluginRegistry
  hostServices?: Partial<PluginHostServices>
}): PluginContext {
  const hostServices: PluginHostServices = {
    ...defaultHostServices,
    ...input.hostServices,
  }
  const subscriptions: PluginContext['subscriptions'] = []

  const workspace: WorkspaceApi = {
    getCurrentWorkspaceId() {
      assertPermission(hostServices, input.manifest, 'workspace.read', 'workspace.getCurrentWorkspaceId')
      return hostServices.getCurrentWorkspaceId()
    },
    subscribeCurrentWorkspaceId(listener) {
      assertPermission(hostServices, input.manifest, 'workspace.observe', 'workspace.subscribeCurrentWorkspaceId')
      return hostServices.subscribeCurrentWorkspaceId(listener)
    },
  }

  const learning: LearningApi = {
    getState() {
      assertPermission(hostServices, input.manifest, 'learning.read', 'learning.getState')
      return hostServices.getLearningState()
    },
    subscribeState(listener) {
      assertPermission(hostServices, input.manifest, 'learning.observe', 'learning.subscribeState')
      return hostServices.subscribeLearningState(listener)
    },
    getMeta(workspaceId) {
      assertPermission(hostServices, input.manifest, 'learning.read', 'learning.getMeta')
      return hostServices.getLearningMeta(workspaceId)
    },
    getSummary(definition) {
      assertPermission(hostServices, input.manifest, 'learning.read', 'learning.getSummary')
      return hostServices.getLearningSummary(definition.workspaceId, definition.days)
    },
    getDailyRecord(definition) {
      assertPermission(hostServices, input.manifest, 'learning.read', 'learning.getDailyRecord')
      return hostServices.getLearningDailyRecord(definition.workspaceId, definition.date)
    },
    getDailyRecords(definition) {
      assertPermission(hostServices, input.manifest, 'learning.read', 'learning.getDailyRecords')
      return hostServices.getLearningDailyRecords(definition.workspaceId, definition.dates)
    },
  }

  const logs: LogsApi = {
    getBuffer() {
      assertPermission(hostServices, input.manifest, 'logs.read', 'logs.getBuffer')
      return hostServices.getLogBuffer()
    },
    getAvailableDates() {
      assertPermission(hostServices, input.manifest, 'logs.read', 'logs.getAvailableDates')
      return hostServices.getLogAvailableDates()
    },
    query(definition) {
      assertPermission(hostServices, input.manifest, 'logs.read', 'logs.query')
      return hostServices.queryLogs(definition)
    },
    subscribe(listener) {
      assertPermission(hostServices, input.manifest, 'logs.subscribe', 'logs.subscribe')
      return hostServices.subscribeLogs(listener)
    },
  }

  const performance: PerformanceApi = {
    getMetricDefinitions() {
      assertPermission(hostServices, input.manifest, 'performance.read', 'performance.getMetricDefinitions')
      return hostServices.getPerformanceMetricDefinitions()
    },
    querySamples(inputValue) {
      assertPermission(hostServices, input.manifest, 'performance.read', 'performance.querySamples')
      return hostServices.queryPerformanceSamples(inputValue)
    },
    subscribeSamples(listener, inputValue) {
      assertPermission(hostServices, input.manifest, 'performance.subscribe', 'performance.subscribeSamples')
      return hostServices.subscribePerformanceSamples(listener, inputValue)
    },
  }

  const plugins: PluginsApi = {
    listDiagnostics() {
      assertPermission(hostServices, input.manifest, 'plugins.diagnostics.read', 'plugins.listDiagnostics')
      return hostServices.listPluginDiagnostics()
    },
    getDiagnostics(pluginId) {
      assertPermission(hostServices, input.manifest, 'plugins.diagnostics.read', 'plugins.getDiagnostics')
      return hostServices.getPluginDiagnostics(pluginId)
    },
    subscribeDiagnostics(listener) {
      assertPermission(hostServices, input.manifest, 'plugins.diagnostics.read', 'plugins.subscribeDiagnostics')
      return hostServices.subscribePluginDiagnostics(listener)
    },
    retryActivation(pluginId) {
      assertPermission(hostServices, input.manifest, 'plugins.diagnostics.retry', 'plugins.retryActivation')
      return hostServices.retryPluginActivation(pluginId)
    },
  }

  const views: ViewApi = {
    register(definition) {
      assertPermission(hostServices, input.manifest, 'view.register', 'views.register')
      try {
        return input.registry.bindView(input.manifest.id, definition)
      } catch (error) {
        return reportBindingFailure(input.registry, input.manifest, 'view', definition.viewId, error)
      }
    },
    open(viewId) {
      assertPermission(hostServices, input.manifest, 'view.open', 'views.open')
      return hostServices.openView(viewId)
    },
  }

  const commands: CommandApi = {
    register(definition) {
      assertPermission(hostServices, input.manifest, 'command.register', 'commands.register')
      try {
        return input.registry.bindCommand(input.manifest.id, definition)
      } catch (error) {
        return reportBindingFailure(input.registry, input.manifest, 'command', definition.commandId, error)
      }
    },
    async execute(commandId, args) {
      assertPermission(hostServices, input.manifest, 'command.execute', 'commands.execute')
      await hostServices.executeCommand(commandId, args)
    },
  }

  const ui: UiApi = {
    registerWidget(definition) {
      assertPermission(hostServices, input.manifest, 'widget.register', 'ui.registerWidget')
      try {
        return input.registry.bindWidget(input.manifest.id, definition)
      } catch (error) {
        return reportBindingFailure(input.registry, input.manifest, 'widget', definition.widgetId, error)
      }
    },
    notify(inputValue) {
      assertPermission(hostServices, input.manifest, 'ui.notify', 'ui.notify')
      hostServices.notify(inputValue)
    },
  }

  const log: LoggingApi = {
    info(message, details) {
      assertPermission(hostServices, input.manifest, 'log.write', 'log.write')
      hostServices.log('info', input.manifest.id, message, details)
    },
    warn(message, details) {
      assertPermission(hostServices, input.manifest, 'log.write', 'log.write')
      hostServices.log('warn', input.manifest.id, message, details)
    },
    error(message, details) {
      assertPermission(hostServices, input.manifest, 'log.write', 'log.write')
      hostServices.log('error', input.manifest.id, message, details)
    },
  }

  return {
    pluginId: input.manifest.id,
    manifest: input.manifest,
    activationReason: input.activationReason,
    subscriptions,
    workspace,
    views,
    commands,
    ui,
    learning,
    logs,
    performance,
    plugins,
    log,
  }
}
