import {
  PLUGIN_KINDS,
  PLUGIN_PERMISSIONS,
  type AnalyticsContribution,
  type CommandContribution,
  type PluginActivationEvent,
  type PluginKind,
  type PluginManifest,
  type PluginPermission,
  type SettingContribution,
  type WidgetContribution,
} from '../public/manifest.ts'
import {
  SECONDARY_VIEW_PLACEMENTS,
  type SecondaryViewContribution,
} from '../extension-points/secondaryViews.ts'

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }

  return value as Record<string, unknown>
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }

  return value
}

function asOneOf<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  label: string,
): T {
  const normalized = asString(value, label)

  if (!allowedValues.includes(normalized as T)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(', ')}`)
  }

  return normalized as T
}

function asStringArray<T extends string>(value: unknown, label: string): T[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${label} must be a string array`)
  }

  return value as T[]
}

function assertUniqueIds(
  entries: Array<{ id: string }>,
  label: string,
): void {
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`${label} contains duplicate id: ${entry.id}`)
    }

    seen.add(entry.id)
  }
}

function assertUniqueKeys(
  entries: Array<{ key: string }>,
  label: string,
): void {
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.key)) {
      throw new Error(`${label} contains duplicate key: ${entry.key}`)
    }

    seen.add(entry.key)
  }
}

function isValidActivationEvent(value: string): value is PluginActivationEvent {
  return (
    value === 'onAppReady' ||
    value === 'onWorkspaceReady' ||
    /^onCommand:[^:\s]+$/.test(value) ||
    /^onViewOpen:[^:\s]+$/.test(value)
  )
}

function parseSecondaryViews(value: unknown): SecondaryViewContribution[] | undefined {
  if (value == null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('manifest.contributes.secondaryViews must be an array')
  }

  return value.map((item, index) => {
    const record = asRecord(item, `manifest.contributes.secondaryViews[${index}]`)

    return {
      id: asString(record.id, `manifest.contributes.secondaryViews[${index}].id`),
      title: asString(record.title, `manifest.contributes.secondaryViews[${index}].title`),
      icon: typeof record.icon === 'string' ? record.icon : undefined,
      placement: asOneOf(
        record.placement,
        SECONDARY_VIEW_PLACEMENTS,
        `manifest.contributes.secondaryViews[${index}].placement`,
      ) as SecondaryViewContribution['placement'],
      openCommand: typeof record.openCommand === 'string' ? record.openCommand : undefined,
    }
  })
}

function parseCommands(value: unknown): CommandContribution[] | undefined {
  if (value == null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('manifest.contributes.commands must be an array')
  }

  return value.map((item, index) => {
    const record = asRecord(item, `manifest.contributes.commands[${index}]`)

    return {
      id: asString(record.id, `manifest.contributes.commands[${index}].id`),
      title: asString(record.title, `manifest.contributes.commands[${index}].title`),
    }
  })
}

function parseWidgets(value: unknown): WidgetContribution[] | undefined {
  if (value == null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('manifest.contributes.widgets must be an array')
  }

  return value.map((item, index) => {
    const record = asRecord(item, `manifest.contributes.widgets[${index}]`)

    return {
      id: asString(record.id, `manifest.contributes.widgets[${index}].id`),
      title: asString(record.title, `manifest.contributes.widgets[${index}].title`),
      placement: asString(
        record.placement,
        `manifest.contributes.widgets[${index}].placement`,
      ) as WidgetContribution['placement'],
    }
  })
}

function parseSettings(value: unknown): SettingContribution[] | undefined {
  if (value == null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('manifest.contributes.settings must be an array')
  }

  return value.map((item, index) => {
    const record = asRecord(item, `manifest.contributes.settings[${index}]`)

    return {
      key: asString(record.key, `manifest.contributes.settings[${index}].key`),
      type: asString(
        record.type,
        `manifest.contributes.settings[${index}].type`,
      ) as SettingContribution['type'],
      title: asString(record.title, `manifest.contributes.settings[${index}].title`),
      default: record.default,
    }
  })
}

function parseAnalytics(value: unknown): AnalyticsContribution[] | undefined {
  if (value == null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('manifest.contributes.analytics must be an array')
  }

  return value.map((item, index) => {
    const record = asRecord(item, `manifest.contributes.analytics[${index}]`)

    return {
      id: asString(record.id, `manifest.contributes.analytics[${index}].id`),
      title: asString(record.title, `manifest.contributes.analytics[${index}].title`),
    }
  })
}

export function validatePluginManifest(input: unknown): PluginManifest {
  const record = asRecord(input, 'manifest')
  const contributesRecord =
    record.contributes == null ? undefined : asRecord(record.contributes, 'manifest.contributes')
  const activationEvents = asStringArray<PluginActivationEvent>(
    record.activationEvents,
    'manifest.activationEvents',
  )
  const permissions = asStringArray<PluginPermission>(record.permissions, 'manifest.permissions')
  const contributes = contributesRecord
    ? {
        secondaryViews: parseSecondaryViews(contributesRecord.secondaryViews),
        commands: parseCommands(contributesRecord.commands),
        widgets: parseWidgets(contributesRecord.widgets),
        settings: parseSettings(contributesRecord.settings),
        analytics: parseAnalytics(contributesRecord.analytics),
      }
    : undefined

  for (const event of activationEvents) {
    if (!isValidActivationEvent(event)) {
      throw new Error(`manifest.activationEvents contains invalid value: ${event}`)
    }
  }

  for (const permission of permissions) {
    if (!PLUGIN_PERMISSIONS.includes(permission)) {
      throw new Error(`manifest.permissions contains invalid value: ${permission}`)
    }
  }

  assertUniqueIds(contributes?.secondaryViews ?? [], 'manifest.contributes.secondaryViews')
  assertUniqueIds(contributes?.commands ?? [], 'manifest.contributes.commands')
  assertUniqueIds(contributes?.widgets ?? [], 'manifest.contributes.widgets')
  assertUniqueIds(contributes?.analytics ?? [], 'manifest.contributes.analytics')
  assertUniqueKeys(contributes?.settings ?? [], 'manifest.contributes.settings')

  const contributedCommandIds = new Set((contributes?.commands ?? []).map((command) => command.id))
  for (const view of contributes?.secondaryViews ?? []) {
    if (view.openCommand && !contributedCommandIds.has(view.openCommand)) {
      throw new Error(
        `manifest.contributes.secondaryViews references missing openCommand: ${view.openCommand}`,
      )
    }
  }

  if ((contributes?.secondaryViews?.length ?? 0) > 0 && !permissions.includes('view.register')) {
    throw new Error('manifest.permissions must include view.register when secondaryViews are contributed')
  }

  if ((contributes?.commands?.length ?? 0) > 0 && !permissions.includes('command.register')) {
    throw new Error('manifest.permissions must include command.register when commands are contributed')
  }

  if ((contributes?.widgets?.length ?? 0) > 0 && !permissions.includes('widget.register')) {
    throw new Error('manifest.permissions must include widget.register when widgets are contributed')
  }

  if ((contributes?.analytics?.length ?? 0) > 0 && !permissions.includes('analytics.register')) {
    throw new Error('manifest.permissions must include analytics.register when analytics are contributed')
  }

  return {
    id: asString(record.id, 'manifest.id'),
    name: asString(record.name, 'manifest.name'),
    displayName: asString(record.displayName, 'manifest.displayName'),
    description: typeof record.description === 'string' ? record.description : undefined,
    version: asString(record.version, 'manifest.version'),
    hostVersion: asString(record.hostVersion, 'manifest.hostVersion'),
    kind: asOneOf(record.kind, PLUGIN_KINDS, 'manifest.kind') as PluginKind,
    entry: asString(record.entry, 'manifest.entry'),
    activationEvents,
    permissions,
    contributes,
  }
}
