import type { CommandApi, LearningApi, LoggingApi, LogsApi, PerformanceApi, PluginsApi, UiApi, ViewApi, WorkspaceApi } from './api'
import type { Disposable } from './disposables'
import type { PluginManifest } from './manifest'

export type ActivationReason =
  | { type: 'app-ready' }
  | { type: 'workspace-ready' }
  | { type: 'command'; commandId: string }
  | { type: 'view'; viewId: string }

export interface PluginContext {
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly activationReason: ActivationReason
  readonly subscriptions: Disposable[]
  readonly workspace: WorkspaceApi
  readonly views: ViewApi
  readonly commands: CommandApi
  readonly ui: UiApi
  readonly learning: LearningApi
  readonly logs: LogsApi
  readonly performance: PerformanceApi
  readonly plugins: PluginsApi
  readonly log: LoggingApi
}

export interface TopoMindPluginModule {
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
