import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  loadLearningStatisticsData,
  subscribeLearningStatisticsWorkspace,
} from '../src/plugins/builtin/learning-statistics/runtime.ts'
import {
  initializeMonitorPage,
  subscribeMonitorDiagnostics,
  subscribeMonitorLogs,
} from '../src/plugins/builtin/monitor/runtime.ts'
import { PluginManager } from '../src/plugins/host/pluginManager.ts'
import { createPluginContext } from '../src/plugins/host/pluginContext.ts'
import { validatePluginManifest } from '../src/plugins/host/pluginManifest.ts'
import { PluginRegistry } from '../src/plugins/host/pluginRegistry.ts'
import type {
  LearningApi,
  LoggingApi,
  LogsApi,
  PluginDiagnosticsSnapshot,
  PluginsApi,
  WorkspaceApi,
} from '../src/plugins/public/api'
import type { PluginContext } from '../src/plugins/public/plugin.ts'
import { BuiltinPluginLoader } from '../src/plugins/runtime/builtinPluginLoader.ts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..')

const noopHostServices = {
  getCurrentWorkspaceId: () => 'workspace:test',
  subscribeCurrentWorkspaceId: () => ({ dispose() {} }),
  getLearningState: () => ({
    isActive: false,
    todayDuration: 0,
    currentSession: null,
    meta: null,
  }),
  subscribeLearningState: () => ({ dispose() {} }),
  getLearningMeta: async () => null,
  getLearningSummary: async () => ({}),
  getLearningDailyRecord: async () => null,
  getLearningDailyRecords: async () => ({}),
  getLogBuffer: async () => [],
  getLogAvailableDates: async () => [],
  queryLogs: async () => [],
  subscribeLogs: () => ({ dispose() {} }),
  getPerformanceMetricDefinitions: () => [],
  queryPerformanceSamples: async () => [],
  subscribePerformanceSamples: () => ({ dispose() {} }),
  listPluginDiagnostics: () => [],
  getPluginDiagnostics: () => null,
  subscribePluginDiagnostics: () => ({ dispose() {} }),
  retryPluginActivation: async () => {},
  openView: async () => {},
  executeCommand: async () => {},
  notify: () => {},
  log: () => {},
}

let viteServerPromise:
  | Promise<Awaited<ReturnType<typeof createServer>>>
  | null = null

async function loadModuleWithVite<T = Record<string, unknown>>(entryPath: string): Promise<T> {
  if (!viteServerPromise) {
    viteServerPromise = createServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'error',
      root: repoRoot,
      resolve: {
        alias: {
          '@': path.resolve(repoRoot, 'src'),
        },
      },
      server: {
        middlewareMode: true,
      },
    })
  }

  const server = await viteServerPromise
  return server.ssrLoadModule(entryPath) as Promise<T>
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.permission-guard',
    name: 'permission-guard',
    displayName: 'Permission Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onViewOpen:sample.view'],
    permissions: ['view.register', 'log.write'],
    contributes: {
      secondaryViews: [
        {
          id: 'sample.view',
          title: 'Sample',
          placement: 'workspace-secondary',
        },
      ],
    },
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'view', viewId: 'sample.view' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.views.open('sample.view')
  }, /view\.open/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.workspace-observe-guard',
    name: 'workspace-observe-guard',
    displayName: 'Workspace Observe Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['workspace.read', 'log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.workspace.subscribeCurrentWorkspaceId(() => {})
  }, /workspace\.subscribeCurrentWorkspaceId/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.logs-read-guard',
    name: 'logs-read-guard',
    displayName: 'Logs Read Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  await assert.rejects(async () => {
    await context.logs.getBuffer()
  }, /logs\.getBuffer/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.learning-read-guard',
    name: 'learning-read-guard',
    displayName: 'Learning Read Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.learning.getState()
  }, /learning\.getState/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.learning-observe-guard',
    name: 'learning-observe-guard',
    displayName: 'Learning Observe Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['learning.read', 'log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.learning.subscribeState(() => {})
  }, /learning\.subscribeState/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.performance-read-guard',
    name: 'performance-read-guard',
    displayName: 'Performance Read Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.performance.getMetricDefinitions()
  }, /performance\.getMetricDefinitions/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.performance-subscribe-guard',
    name: 'performance-subscribe-guard',
    displayName: 'Performance Subscribe Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['performance.read', 'log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.performance.subscribeSamples(() => {})
  }, /performance\.subscribeSamples/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.plugins-diagnostics-read-guard',
    name: 'plugins-diagnostics-read-guard',
    displayName: 'Plugins Diagnostics Read Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.plugins.listDiagnostics()
  }, /plugins\.listDiagnostics/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.plugins-diagnostics-retry-guard',
    name: 'plugins-diagnostics-retry-guard',
    displayName: 'Plugins Diagnostics Retry Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['plugins.diagnostics.read', 'log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  await assert.rejects(async () => {
    await context.plugins.retryActivation('topomind.sample')
  }, /plugins\.retryActivation/)
}

{
  const manifest = validatePluginManifest({
    id: 'topomind.widget-guard',
    name: 'widget-guard',
    displayName: 'Widget Guard',
    version: '0.1.0',
    hostVersion: '^5.2.0',
    kind: 'builtin',
    entry: './index.ts',
    activationEvents: ['onAppReady'],
    permissions: ['log.write'],
  })

  const context = createPluginContext({
    manifest,
    activationReason: { type: 'app-ready' },
    registry: new PluginRegistry(),
    hostServices: noopHostServices,
  })

  assert.throws(() => {
    void context.ui.registerWidget({
      widgetId: 'sample.widget',
      placement: 'titlebar',
      render: () => null,
    })
  }, /widget\.register/)
}

{
  let commandExecuted = false
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.command-guard',
        name: 'command-guard',
        displayName: 'Command Guard',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onCommand:sample.run'],
        permissions: ['command.register', 'log.write'],
        contributes: {
          commands: [
            {
              id: 'sample.run',
              title: 'Run sample command',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate(ctx: PluginContext) {
            ctx.subscriptions.push(
              ctx.commands.register({
                commandId: 'sample.run',
                execute: async () => {
                  commandExecuted = true
                },
              }),
            )
          },
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  await manager.executeCommand('sample.run')
  assert.equal(commandExecuted, true)
}

{
  let activateCount = 0
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.disable-guard',
        name: 'disable-guard',
        displayName: 'Disable Guard',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onCommand:disable.run'],
        permissions: ['command.register', 'log.write'],
        contributes: {
          commands: [
            {
              id: 'disable.run',
              title: 'Disable guard command',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate(ctx: PluginContext) {
            activateCount += 1
            ctx.subscriptions.push(
              ctx.commands.register({
                commandId: 'disable.run',
                execute: async () => {},
              }),
            )
          },
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  await manager.executeCommand('disable.run')
  await manager.disable('topomind.disable-guard')
  await assert.rejects(() => manager.executeCommand('disable.run'), /Plugin is disabled/)
  assert.equal(activateCount, 1)
  assert.equal(manager.getPluginDiagnostics('topomind.disable-guard')?.state, 'disabled')
}

{
  let appReadyActivated = false
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.app-ready-widget',
        name: 'app-ready-widget',
        displayName: 'App Ready Widget',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onAppReady'],
        permissions: ['widget.register', 'log.write'],
        contributes: {
          widgets: [
            {
              id: 'app.ready.widget',
              title: 'App Ready Widget',
              placement: 'titlebar',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate(ctx: PluginContext) {
            appReadyActivated = true
            ctx.subscriptions.push(
              ctx.ui.registerWidget({
                widgetId: 'app.ready.widget',
                placement: 'titlebar',
                render: () => null,
              }),
            )
          },
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  await manager.activateByReason({ type: 'app-ready' })
  assert.equal(appReadyActivated, true)
  assert.equal(manager.getRegistry().getWidgetRenderer('app.ready.widget') != null, true)
}

{
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.failure-diagnostics',
        name: 'failure-diagnostics',
        displayName: 'Failure Diagnostics',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onViewOpen:broken.view'],
        permissions: ['view.register', 'log.write'],
        contributes: {
          secondaryViews: [
            {
              id: 'broken.view',
              title: 'Broken View',
              placement: 'workspace-secondary',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate() {
            throw new Error('boom from broken plugin')
          },
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  await assert.rejects(
    () => manager.ensureActivated('topomind.failure-diagnostics', { type: 'view', viewId: 'broken.view' }),
    /boom from broken plugin/,
  )

  const diagnostics = manager.getPluginDiagnostics('topomind.failure-diagnostics')
  assert.equal(diagnostics?.state, 'failed')
  assert.match(diagnostics?.lastErrorMessage ?? '', /boom from broken plugin/)
  assert.equal(typeof diagnostics?.lastFailedAt, 'string')
}

{
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.diagnostics-stream',
        name: 'diagnostics-stream',
        displayName: 'Diagnostics Stream',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onViewOpen:stream.view'],
        permissions: ['view.register', 'log.write'],
        contributes: {
          secondaryViews: [
            {
              id: 'stream.view',
              title: 'Stream View',
              placement: 'workspace-secondary',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate(ctx: PluginContext) {
            ctx.subscriptions.push(
              ctx.views.register({
                viewId: 'stream.view',
                render: () => null,
              }),
            )

            ctx.views.register({
              viewId: 'stream.view',
              render: () => null,
            })
          },
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  manager.discover()

  const runtimeStatuses: string[] = []
  const subscription = manager.subscribeDiagnostics((diagnostics) => {
    const item = diagnostics.find((entry) => entry.pluginId === 'topomind.diagnostics-stream')
    runtimeStatuses.push(item?.runtimeRecords[0]?.status ?? 'none')
  })

  await assert.rejects(
    () => manager.ensureActivated('topomind.diagnostics-stream', { type: 'view', viewId: 'stream.view' }),
    /already bound/,
  )

  subscription.dispose()
  assert.equal(runtimeStatuses.includes('failed'), true)

  const diagnostics = manager.getPluginDiagnostics('topomind.diagnostics-stream')
  assert.equal(diagnostics?.state, 'failed')
  assert.deepEqual(diagnostics?.runtimeRecords, [
    {
      pluginId: 'topomind.diagnostics-stream',
      contributionType: 'view',
      contributionId: 'stream.view',
      status: 'failed',
      errorMessage: 'View stream.view is already bound',
    },
  ])
}

{
  const loader = new BuiltinPluginLoader([
    {
      manifestData: {
        id: 'topomind.activation-guard',
        name: 'activation-guard',
        displayName: 'Activation Guard',
        version: '0.1.0',
        hostVersion: '^5.2.0',
        kind: 'builtin',
        entry: './index.ts',
        activationEvents: ['onViewOpen:declared.view'],
        permissions: ['view.register', 'log.write'],
        contributes: {
          secondaryViews: [
            {
              id: 'declared.view',
              title: 'Declared View',
              placement: 'workspace-secondary',
            },
          ],
        },
      },
      loadModule: async () => ({
        default: {
          activate() {},
        },
      }),
    },
  ])

  const manager = new PluginManager({
    loader,
    hostServices: noopHostServices,
  })

  await assert.rejects(
    () => manager.ensureActivated('topomind.activation-guard', { type: 'view', viewId: 'other.view' }),
    /declare it in manifest\.activationEvents first/,
  )
}

{
  const openViews: string[] = []
  const executedCommands: string[] = []
  const learningSummaryRequests: number[] = []
  const learningDailyRecordRequests: string[][] = []
  const workspaceListeners: Array<(workspaceId: string | null) => void> = []
  const observedWorkspaceIds: Array<string | null> = []
  const manager = new PluginManager({
    loader: new BuiltinPluginLoader(),
    hostServices: {
      ...noopHostServices,
      openView: async (viewId: string) => {
        openViews.push(viewId)
      },
      executeCommand: async (commandId: string) => {
        executedCommands.push(commandId)
      },
      subscribeCurrentWorkspaceId: (listener) => {
        workspaceListeners.push(listener)
        return { dispose() {} }
      },
      getLearningSummary: async (_workspaceId, days) => {
        learningSummaryRequests.push(days)
        return {
          '2026-06-03': 1800,
          '2026-06-04': 2400,
        }
      },
      getLearningDailyRecords: async (_workspaceId, dates) => {
        learningDailyRecordRequests.push([...dates])
        return Object.fromEntries(
          dates.map((date) => [
            date,
            {
              date,
              totalDuration: date === '2026-06-04' ? 2400 : 1800,
              sessions: [],
            },
          ]),
        )
      },
    },
  })

  await manager.executeCommand('learning.open')

  const diagnostics = manager.getPluginDiagnostics('topomind.learning-statistics')
  assert.equal(diagnostics?.state, 'running')
  assert.deepEqual(
    diagnostics?.runtimeRecords.map((record) => `${record.contributionType}:${record.contributionId}:${record.status}`),
    [
      'view:learning.statistics:bound',
      'command:learning.open:bound',
      'widget:learning.titlebar.overview:bound',
    ],
  )

  assert.deepEqual(openViews, ['learning.statistics'])

  const registry = manager.getRegistry()
  const viewRenderer = registry.getViewRenderer('learning.statistics')
  const widgetRenderer = registry.getWidgetRenderer('learning.titlebar.overview')

  assert.equal(typeof viewRenderer, 'function')
  assert.equal(typeof widgetRenderer, 'function')

  const viewNode = viewRenderer?.({
    viewId: 'learning.statistics',
    pluginId: 'topomind.learning-statistics',
  }) as { props?: { onBackHome?: () => Promise<void>; learning?: unknown; workspace?: unknown } } | null
  const widgetNode = widgetRenderer?.({
    widgetId: 'learning.titlebar.overview',
    pluginId: 'topomind.learning-statistics',
  }) as { props?: { onOpenStatistics?: () => Promise<void>; learning?: unknown; workspace?: unknown } } | null

  assert.equal(typeof viewNode?.props?.learning, 'object')
  assert.equal(typeof viewNode?.props?.workspace, 'object')
  assert.equal(typeof widgetNode?.props?.learning, 'object')
  assert.equal(typeof widgetNode?.props?.workspace, 'object')

  const learningEntryModule = await loadModuleWithVite<{
    loadLearningStatisticsPageModule: () => Promise<{
      default: (props: {
        learning: unknown
        workspace: unknown
        onBackHome: () => void | Promise<void>
      }) => ReturnType<typeof createElement>
    }>
  }>('/src/plugins/builtin/learning-statistics/LearningStatisticsPageEntry.ts')
  const learningPageModule = await learningEntryModule.loadLearningStatisticsPageModule()
  const learningMarkup = renderToStaticMarkup(
    createElement(learningPageModule.default, {
      learning: viewNode?.props?.learning,
      workspace: viewNode?.props?.workspace,
      onBackHome: viewNode?.props?.onBackHome ?? (() => {}),
    }),
  )

  assert.match(learningMarkup, /学习统计/)

  const learningData = await loadLearningStatisticsData({
    learning: viewNode?.props?.learning as LearningApi,
    loadedRecordDates: ['2026-06-03', '2026-06-04'],
    summaryWindowDays: 90,
  })
  const workspaceSubscription = subscribeLearningStatisticsWorkspace(
    viewNode?.props?.workspace as WorkspaceApi,
    (workspaceId) => {
      observedWorkspaceIds.push(workspaceId)
    },
  )

  assert.equal(learningData.summaryByDate['2026-06-04'], 2400)
  assert.equal(learningData.rangeRecords['2026-06-03']?.totalDuration, 1800)
  assert.deepEqual(learningSummaryRequests, [90])
  assert.deepEqual(learningDailyRecordRequests, [['2026-06-03', '2026-06-04']])
  assert.equal(workspaceListeners.length, 1)
  workspaceListeners[0]?.('workspace:changed')
  assert.deepEqual(observedWorkspaceIds, ['workspace:changed'])
  workspaceSubscription.dispose()

  await viewNode?.props?.onBackHome?.()
  await widgetNode?.props?.onOpenStatistics?.()

  assert.deepEqual(executedCommands, ['home.open'])
  assert.deepEqual(openViews, ['learning.statistics', 'learning.statistics'])
}

{
  const openViews: string[] = []
  const logsQueryInputs: Array<{ date?: string; keyword?: string; levels?: string[] }> = []
  const retriedPlugins: string[] = []
  const performanceSubscriptions: Array<{ date?: string | null }> = []
  const logBufferCalls: number[] = []
  const logAvailableDateCalls: number[] = []
  const listedDiagnosticsSnapshots: number[] = []
  const subscribedLogEntries: Array<(entry: { timestamp?: string; level?: 'INFO'; message?: string }) => void> = []
  const subscribedDiagnostics: Array<(diagnostics: PluginDiagnosticsSnapshot[]) => void> = []
  const pluginLogs: Array<{ message: string; details?: unknown }> = []
  const observedMonitorMessages: string[] = []
  const observedDiagnosticPluginIds: string[] = []
  const manager = new PluginManager({
    loader: new BuiltinPluginLoader(),
    hostServices: {
      ...noopHostServices,
      openView: async (viewId: string) => {
        openViews.push(viewId)
      },
      queryLogs: async (input) => {
        logsQueryInputs.push(input ?? {})
        return input?.levels?.includes('ERROR')
          ? [
              {
                id: 'log:error',
                timestamp: '2026-06-04T10:00:00.000Z',
                level: 'ERROR',
                message: 'error sample',
              },
            ]
          : [
              {
                id: 'log:info',
                timestamp: '2026-06-04T09:00:00.000Z',
                level: 'INFO',
                message: 'info sample',
              },
            ]
      },
      getLogBuffer: async () => {
        logBufferCalls.push(1)
        return [
          {
            id: 'buffer:1',
            timestamp: '2026-06-04T08:00:00.000Z',
            level: 'INFO',
            message: 'buffer entry',
          },
        ]
      },
      getLogAvailableDates: async () => {
        logAvailableDateCalls.push(1)
        return ['2026-06-04']
      },
      subscribeLogs: (listener) => {
        subscribedLogEntries.push(listener)
        return { dispose() {} }
      },
      getPerformanceMetricDefinitions: () => [
        {
          id: 'room_load',
          label: '房间加载',
          shortLabel: '加载',
          color: '#3b82f6',
          thresholdMs: 400,
        },
      ],
      queryPerformanceSamples: async (input) => [
        {
          id: 'sample:1',
          metric: 'room_load',
          label: '房间加载',
          shortLabel: '加载',
          color: '#3b82f6',
          thresholdMs: 400,
          durationMs: 320,
          success: true,
          timestamp: '2026-06-04T09:00:00.000Z',
          timestampMs: Date.parse('2026-06-04T09:00:00.000Z'),
          params: { date: input?.date ?? null },
        },
      ],
      subscribePerformanceSamples: (_listener, input) => {
        performanceSubscriptions.push(input ?? {})
        return { dispose() {} }
      },
      listPluginDiagnostics: () => [
        {
          pluginId: 'topomind.monitor',
          manifest: {
            id: 'topomind.monitor',
            name: 'monitor',
            displayName: '系统日志',
            version: '1.0.0',
            hostVersion: '^5.2.0',
            kind: 'builtin',
            entry: './index.ts',
            activationEvents: ['onCommand:monitor.open'],
            permissions: ['plugins.diagnostics.read'],
          },
          state: 'failed',
          lastActivationReason: { type: 'command', commandId: 'monitor.open' },
          lastErrorMessage: 'boom',
          lastFailedAt: '2026-06-04T09:30:00.000Z',
          runtimeRecords: [],
        },
      ].map((item) => {
        listedDiagnosticsSnapshots.push(1)
        return item
      }),
      retryPluginActivation: async (pluginId: string) => {
        retriedPlugins.push(pluginId)
      },
      subscribePluginDiagnostics: (listener) => {
        subscribedDiagnostics.push(listener)
        return { dispose() {} }
      },
      log: (_level, _pluginId, message, details) => {
        pluginLogs.push({ message, details })
      },
    },
  })

  await manager.executeCommand('monitor.open')

  const diagnostics = manager.getPluginDiagnostics('topomind.monitor')
  assert.equal(diagnostics?.state, 'running')
  assert.deepEqual(
    diagnostics?.runtimeRecords.map((record) => `${record.contributionType}:${record.contributionId}:${record.status}`),
    [
      'view:monitor.logs:bound',
      'command:monitor.open:bound',
    ],
  )

  assert.deepEqual(openViews, ['monitor.logs'])

  const registry = manager.getRegistry()
  const viewRenderer = registry.getViewRenderer('monitor.logs')
  assert.equal(typeof viewRenderer, 'function')

  const viewNode = viewRenderer?.({
    viewId: 'monitor.logs',
    pluginId: 'topomind.monitor',
  }) as { props?: { logs?: unknown; performance?: unknown; plugins?: unknown; log?: unknown } } | null

  assert.equal(typeof viewNode?.props?.logs, 'object')
  assert.equal(typeof viewNode?.props?.performance, 'object')
  assert.equal(typeof viewNode?.props?.plugins, 'object')
  assert.equal(typeof viewNode?.props?.log, 'object')

  const monitorEntryModule = await loadModuleWithVite<{
    loadMonitorPageModule: () => Promise<{
      default: (props: {
        logs: unknown
        performance: unknown
        plugins: unknown
        log: unknown
      }) => ReturnType<typeof createElement>
    }>
  }>('/src/plugins/builtin/monitor/MonitorPageEntry.ts')
  const monitorPageModule = await monitorEntryModule.loadMonitorPageModule()
  const monitorMarkup = renderToStaticMarkup(
    createElement(monitorPageModule.default, {
      logs: viewNode?.props?.logs,
      performance: viewNode?.props?.performance,
      plugins: viewNode?.props?.plugins,
      log: viewNode?.props?.log,
    }),
  )

  assert.match(monitorMarkup, /日志|性能|插件/)

  const monitorState = await initializeMonitorPage({
    logs: viewNode?.props?.logs as LogsApi,
    plugins: viewNode?.props?.plugins as PluginsApi,
    log: viewNode?.props?.log as LoggingApi,
    now: () => new Date('2026-06-04T11:00:00.000Z'),
  })
  const logSubscription = subscribeMonitorLogs(viewNode?.props?.logs as LogsApi, (entry) => {
    observedMonitorMessages.push(entry.message)
  })
  const diagnosticsSubscription = subscribeMonitorDiagnostics(
    viewNode?.props?.plugins as PluginsApi,
    (diagnostics) => {
      observedDiagnosticPluginIds.push(...diagnostics.map((item) => item.pluginId))
    },
  )

  assert.equal(monitorState.entries.length, 1)
  assert.deepEqual(monitorState.availableDates, ['2026-06-04'])
  assert.equal(monitorState.pluginDiagnostics[0]?.pluginId, 'topomind.monitor')
  assert.equal(logBufferCalls.length, 1)
  assert.equal(logAvailableDateCalls.length, 1)
  assert.equal(listedDiagnosticsSnapshots.length, 1)
  assert.equal(subscribedLogEntries.length, 1)
  assert.equal(subscribedDiagnostics.length, 1)
  assert.equal(pluginLogs.some((entry) => entry.message === 'open monitor page'), true)
  subscribedLogEntries[0]?.({
    timestamp: '2026-06-04T12:00:00.000Z',
    level: 'INFO',
    message: 'streamed entry',
  })
  subscribedDiagnostics[0]?.(monitorState.pluginDiagnostics)
  assert.deepEqual(observedMonitorMessages, ['streamed entry'])
  assert.deepEqual(observedDiagnosticPluginIds, ['topomind.monitor'])
  logSubscription.dispose()
  diagnosticsSubscription.dispose()

  await viewNode?.props?.logs?.query?.({ date: '2026-06-04', levels: ['ERROR'] })
  await viewNode?.props?.performance?.querySamples?.({ date: '2026-06-04' })
  await viewNode?.props?.plugins?.retryActivation?.('topomind.monitor')
  viewNode?.props?.performance?.subscribeSamples?.(() => {}, { date: '2026-06-04' })?.dispose?.()

  assert.deepEqual(logsQueryInputs, [{ date: '2026-06-04', levels: ['ERROR'] }])
  assert.deepEqual(retriedPlugins, ['topomind.monitor'])
  assert.deepEqual(performanceSubscriptions, [{ date: '2026-06-04' }])
}

if (viteServerPromise) {
  const server = await viteServerPromise
  await server.close()
}

console.log('Plugin runtime guards verified')
