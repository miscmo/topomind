import type { SecondaryViewContribution } from '../extension-points/secondaryViews'

export const PLUGIN_KINDS = ['builtin', 'local-trusted'] as const
export type PluginKind = (typeof PLUGIN_KINDS)[number]

export type PluginActivationEvent =
  | 'onAppReady'
  | 'onWorkspaceReady'
  | `onCommand:${string}`
  | `onViewOpen:${string}`

export const PLUGIN_PERMISSIONS = [
  'workspace.read',
  'workspace.observe',
  'learning.read',
  'learning.observe',
  'logs.read',
  'logs.subscribe',
  'performance.read',
  'performance.subscribe',
  'plugins.diagnostics.read',
  'plugins.diagnostics.retry',
  'storage.plugin.read',
  'storage.plugin.write',
  'view.register',
  'view.open',
  'command.register',
  'command.execute',
  'widget.register',
  'analytics.register',
  'ui.notify',
  'ui.openExternal',
  'log.write',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export interface CommandContribution {
  id: string
  title: string
}

export interface WidgetContribution {
  id: string
  title: string
  placement: 'titlebar' | 'home'
}

export interface SettingContribution {
  key: string
  type: 'string' | 'number' | 'boolean'
  title: string
  default?: unknown
}

export interface AnalyticsContribution {
  id: string
  title: string
}

export interface PluginContributes {
  secondaryViews?: SecondaryViewContribution[]
  commands?: CommandContribution[]
  widgets?: WidgetContribution[]
  settings?: SettingContribution[]
  analytics?: AnalyticsContribution[]
}

export interface PluginManifest {
  id: string
  name: string
  displayName: string
  description?: string
  version: string
  hostVersion: string
  kind: PluginKind
  entry: string
  activationEvents: PluginActivationEvent[]
  permissions: PluginPermission[]
  contributes?: PluginContributes
}
