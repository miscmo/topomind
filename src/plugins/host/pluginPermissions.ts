import type { PluginManifest, PluginPermission } from '../public/manifest'

export const API_PERMISSION_MAP = {
  'workspace.getCurrentWorkspaceId': 'workspace.read',
  'workspace.subscribeCurrentWorkspaceId': 'workspace.observe',
  'learning.getState': 'learning.read',
  'learning.subscribeState': 'learning.observe',
  'learning.getMeta': 'learning.read',
  'learning.getSummary': 'learning.read',
  'learning.getDailyRecord': 'learning.read',
  'learning.getDailyRecords': 'learning.read',
  'logs.getBuffer': 'logs.read',
  'logs.getAvailableDates': 'logs.read',
  'logs.query': 'logs.read',
  'logs.subscribe': 'logs.subscribe',
  'performance.getMetricDefinitions': 'performance.read',
  'performance.querySamples': 'performance.read',
  'performance.subscribeSamples': 'performance.subscribe',
  'plugins.listDiagnostics': 'plugins.diagnostics.read',
  'plugins.getDiagnostics': 'plugins.diagnostics.read',
  'plugins.subscribeDiagnostics': 'plugins.diagnostics.read',
  'plugins.retryActivation': 'plugins.diagnostics.retry',
  'views.register': 'view.register',
  'views.open': 'view.open',
  'commands.register': 'command.register',
  'commands.execute': 'command.execute',
  'ui.registerWidget': 'widget.register',
  'ui.notify': 'ui.notify',
  'log.write': 'log.write',
} as const satisfies Record<string, PluginPermission>

export class PluginPermissionError extends Error {
  readonly pluginId: string
  readonly permission: PluginPermission
  readonly apiMethod: string

  constructor(pluginId: string, permission: PluginPermission, apiMethod: string) {
    super(`Plugin ${pluginId} does not have permission: ${permission} (${apiMethod})`)
    this.name = 'PluginPermissionError'
    this.pluginId = pluginId
    this.permission = permission
    this.apiMethod = apiMethod
  }
}

export function hasPluginPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
): boolean {
  return manifest.permissions.includes(permission)
}

export function requirePluginPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
  apiMethod: keyof typeof API_PERMISSION_MAP,
): void {
  if (!hasPluginPermission(manifest, permission)) {
    throw new PluginPermissionError(manifest.id, permission, apiMethod)
  }
}
