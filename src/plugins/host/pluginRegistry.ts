import type { ReactNode } from 'react'

import type { SecondaryViewRendererProps, WidgetRendererProps } from '../public/api'
import { toDisposable } from '../public/disposables.ts'
import type { PluginManifest } from '../public/manifest'
import type {
  RuntimeBindingRecord,
  RuntimeCommandBinding,
  RuntimeViewBinding,
  RuntimeWidgetBinding,
  StaticContributionRecord,
} from './pluginTypes'

function toManifestData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function runtimeKey(type: RuntimeBindingRecord['contributionType'], id: string): string {
  return `${type}:${id}`
}

export class PluginRegistry {
  private readonly manifestsByPluginId = new Map<string, PluginManifest>()
  private readonly staticRecordsByPluginId = new Map<string, StaticContributionRecord[]>()
  private readonly runtimeRecordsByPluginId = new Map<string, Map<string, RuntimeBindingRecord>>()
  private readonly staticViewsById = new Map<string, StaticContributionRecord>()
  private readonly staticCommandsById = new Map<string, StaticContributionRecord>()
  private readonly staticWidgetsById = new Map<string, StaticContributionRecord>()
  /** 导航项只做静态发现，不进入 staticRecordsByPluginId：既有贡献点计数契约保持不变。 */
  private readonly staticNavItemsById = new Map<string, StaticContributionRecord>()
  private readonly runtimeViewsById = new Map<string, RuntimeViewBinding>()
  private readonly runtimeCommandsById = new Map<string, RuntimeCommandBinding>()
  private readonly runtimeWidgetsById = new Map<string, RuntimeWidgetBinding>()
  private readonly listeners = new Set<() => void>()
  private notificationDepth = 0
  private hasPendingNotification = false

  indexManifest(manifest: PluginManifest): void {
    if (this.manifestsByPluginId.has(manifest.id)) {
      throw new Error(`Plugin manifest already indexed: ${manifest.id}`)
    }

    const records: StaticContributionRecord[] = []

    for (const view of manifest.contributes?.secondaryViews ?? []) {
      if (this.staticViewsById.has(view.id)) {
        throw new Error(`Duplicate secondary view contribution: ${view.id}`)
      }

      const record: StaticContributionRecord = {
        pluginId: manifest.id,
        contributionType: 'view',
        contributionId: view.id,
        activationEvents: [...manifest.activationEvents],
        manifestData: toManifestData(view),
      }

      records.push(record)
      this.staticViewsById.set(view.id, record)
    }

    for (const command of manifest.contributes?.commands ?? []) {
      if (this.staticCommandsById.has(command.id)) {
        throw new Error(`Duplicate command contribution: ${command.id}`)
      }

      const record: StaticContributionRecord = {
        pluginId: manifest.id,
        contributionType: 'command',
        contributionId: command.id,
        activationEvents: [...manifest.activationEvents],
        manifestData: toManifestData(command),
      }

      records.push(record)
      this.staticCommandsById.set(command.id, record)
    }

    for (const widget of manifest.contributes?.widgets ?? []) {
      if (this.staticWidgetsById.has(widget.id)) {
        throw new Error(`Duplicate widget contribution: ${widget.id}`)
      }

      const record: StaticContributionRecord = {
        pluginId: manifest.id,
        contributionType: 'widget',
        contributionId: widget.id,
        activationEvents: [...manifest.activationEvents],
        manifestData: toManifestData(widget),
      }

      records.push(record)
      this.staticWidgetsById.set(widget.id, record)
    }

    for (const navItem of manifest.contributes?.navItems ?? []) {
      if (this.staticNavItemsById.has(navItem.id)) {
        throw new Error(`Duplicate nav item contribution: ${navItem.id}`)
      }

      // navItem 通过命令打开，记录类型沿用 'command'；它不参与 listStaticRecords 计数，
      // 也不产生 runtime binding，因此不会改变既有插件诊断口径。
      this.staticNavItemsById.set(navItem.id, {
        pluginId: manifest.id,
        contributionType: 'command',
        contributionId: navItem.id,
        activationEvents: [...manifest.activationEvents],
        manifestData: toManifestData(navItem),
      })
    }

    this.manifestsByPluginId.set(manifest.id, manifest)
    this.staticRecordsByPluginId.set(manifest.id, records)
  }

  getManifest(pluginId: string): PluginManifest | undefined {
    return this.manifestsByPluginId.get(pluginId)
  }

  listManifests(): PluginManifest[] {
    return [...this.manifestsByPluginId.values()]
  }

  listStaticRecords(pluginId: string): StaticContributionRecord[] {
    return [...(this.staticRecordsByPluginId.get(pluginId) ?? [])]
  }

  listStaticViews(): StaticContributionRecord[] {
    return [...this.staticViewsById.values()]
  }

  listStaticCommands(): StaticContributionRecord[] {
    return [...this.staticCommandsById.values()]
  }

  listStaticWidgets(): StaticContributionRecord[] {
    return [...this.staticWidgetsById.values()]
  }

  getStaticView(viewId: string): StaticContributionRecord | undefined {
    return this.staticViewsById.get(viewId)
  }

  getStaticCommand(commandId: string): StaticContributionRecord | undefined {
    return this.staticCommandsById.get(commandId)
  }

  getStaticWidget(widgetId: string): StaticContributionRecord | undefined {
    return this.staticWidgetsById.get(widgetId)
  }

  listStaticWidgetsByPlacement(placement: 'titlebar' | 'home'): StaticContributionRecord[] {
    return this.listStaticWidgets().filter((record) => record.manifestData.placement === placement)
  }

  getStaticNavItem(navItemId: string): StaticContributionRecord | undefined {
    return this.staticNavItemsById.get(navItemId)
  }

  /** 按 group 顺序 + order + id 稳定排序，宿主直接消费，不需要运行时 renderer。 */
  listStaticNavItems(): StaticContributionRecord[] {
    return [...this.staticNavItemsById.values()].sort((a, b) => {
      const orderA = typeof a.manifestData.order === 'number' ? a.manifestData.order : 50
      const orderB = typeof b.manifestData.order === 'number' ? b.manifestData.order : 50
      if (orderA !== orderB) return orderA - orderB
      return a.contributionId.localeCompare(b.contributionId)
    })
  }

  getPluginIdByViewId(viewId: string): string | undefined {
    return this.staticViewsById.get(viewId)?.pluginId
  }

  bindView(
    pluginId: string,
    definition: {
      viewId: string
      render: (props: SecondaryViewRendererProps) => ReactNode
    },
  ) {
    const staticRecord = this.staticViewsById.get(definition.viewId)

    if (!staticRecord || staticRecord.pluginId !== pluginId) {
      throw new Error(`View ${definition.viewId} is not declared by plugin ${pluginId}`)
    }

    if (this.runtimeViewsById.has(definition.viewId)) {
      throw new Error(`View ${definition.viewId} is already bound`)
    }

    const disposable = toDisposable(() => {
      this.runtimeViewsById.delete(definition.viewId)
      this.upsertRuntimeRecord({
        pluginId,
        contributionType: 'view',
        contributionId: definition.viewId,
        status: 'pending',
      })
    })

    this.runtimeViewsById.set(definition.viewId, {
      pluginId,
      viewId: definition.viewId,
      render: definition.render,
      disposable,
    })

    this.upsertRuntimeRecord({
      pluginId,
      contributionType: 'view',
      contributionId: definition.viewId,
      status: 'bound',
      disposable,
    })

    return disposable
  }

  bindCommand(
    pluginId: string,
    definition: {
      commandId: string
      execute: (args?: unknown) => void | Promise<void>
    },
  ) {
    const staticRecord = this.staticCommandsById.get(definition.commandId)

    if (!staticRecord || staticRecord.pluginId !== pluginId) {
      throw new Error(`Command ${definition.commandId} is not declared by plugin ${pluginId}`)
    }

    if (this.runtimeCommandsById.has(definition.commandId)) {
      throw new Error(`Command ${definition.commandId} is already bound`)
    }

    const disposable = toDisposable(() => {
      this.runtimeCommandsById.delete(definition.commandId)
      this.upsertRuntimeRecord({
        pluginId,
        contributionType: 'command',
        contributionId: definition.commandId,
        status: 'pending',
      })
    })

    this.runtimeCommandsById.set(definition.commandId, {
      pluginId,
      commandId: definition.commandId,
      execute: definition.execute,
      disposable,
    })

    this.upsertRuntimeRecord({
      pluginId,
      contributionType: 'command',
      contributionId: definition.commandId,
      status: 'bound',
      disposable,
    })

    return disposable
  }

  bindWidget(
    pluginId: string,
    definition: {
      widgetId: string
      placement: 'titlebar' | 'home'
      render: (props: WidgetRendererProps) => ReactNode
    },
  ) {
    const staticRecord = this.staticWidgetsById.get(definition.widgetId)

    if (!staticRecord || staticRecord.pluginId !== pluginId) {
      throw new Error(`Widget ${definition.widgetId} is not declared by plugin ${pluginId}`)
    }

    if (this.runtimeWidgetsById.has(definition.widgetId)) {
      throw new Error(`Widget ${definition.widgetId} is already bound`)
    }

    const staticPlacement = staticRecord.manifestData.placement
    if (staticPlacement !== definition.placement) {
      throw new Error(
        `Widget ${definition.widgetId} must use declared placement ${String(staticPlacement)}`,
      )
    }

    const disposable = toDisposable(() => {
      this.runtimeWidgetsById.delete(definition.widgetId)
      this.upsertRuntimeRecord({
        pluginId,
        contributionType: 'widget',
        contributionId: definition.widgetId,
        status: 'pending',
      })
    })

    this.runtimeWidgetsById.set(definition.widgetId, {
      pluginId,
      widgetId: definition.widgetId,
      placement: definition.placement,
      render: definition.render,
      disposable,
    })

    this.upsertRuntimeRecord({
      pluginId,
      contributionType: 'widget',
      contributionId: definition.widgetId,
      status: 'bound',
      disposable,
    })

    return disposable
  }

  getViewRenderer(viewId: string): ((props: SecondaryViewRendererProps) => ReactNode) | undefined {
    return this.runtimeViewsById.get(viewId)?.render
  }

  getCommandHandler(commandId: string): ((args?: unknown) => void | Promise<void>) | undefined {
    return this.runtimeCommandsById.get(commandId)?.execute
  }

  getWidgetRenderer(widgetId: string): ((props: WidgetRendererProps) => ReactNode) | undefined {
    return this.runtimeWidgetsById.get(widgetId)?.render
  }

  listRuntimeRecords(pluginId: string): RuntimeBindingRecord[] {
    const records = this.runtimeRecordsByPluginId.get(pluginId)

    return records ? [...records.values()] : []
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return toDisposable(() => {
      this.listeners.delete(listener)
    })
  }

  markBindingFailed(
    pluginId: string,
    contributionType: RuntimeBindingRecord['contributionType'],
    contributionId: string,
    error: unknown,
  ): void {
    const existingRecord = this.runtimeRecordsByPluginId
      .get(pluginId)
      ?.get(runtimeKey(contributionType, contributionId))

    this.upsertRuntimeRecord({
      pluginId,
      contributionType,
      contributionId,
      status: 'failed',
      disposable: existingRecord?.disposable,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  clearRuntimeBindings(pluginId: string, options?: { preserveFailedRecords?: boolean }): void {
    const records = this.listRuntimeRecords(pluginId)
    const failedRecordsToPreserve = options?.preserveFailedRecords
      ? records
          .filter((record) => record.status === 'failed')
          .map((record) => {
            const { disposable: _disposable, ...failedRecord } = record
            return failedRecord
          })
      : []

    this.batchNotify(() => {
      for (const record of records) {
        record.disposable?.dispose()
      }

      if (failedRecordsToPreserve.length > 0) {
        this.runtimeRecordsByPluginId.set(
          pluginId,
          new Map(
            failedRecordsToPreserve.map((record) => [
              runtimeKey(record.contributionType, record.contributionId),
              record,
            ]),
          ),
        )
      } else {
        this.runtimeRecordsByPluginId.delete(pluginId)
      }
      this.notifyChanged()
    })
  }

  private upsertRuntimeRecord(record: RuntimeBindingRecord): void {
    const records =
      this.runtimeRecordsByPluginId.get(record.pluginId) ?? new Map<string, RuntimeBindingRecord>()

    records.set(runtimeKey(record.contributionType, record.contributionId), record)
    this.runtimeRecordsByPluginId.set(record.pluginId, records)
    this.notifyChanged()
  }

  private batchNotify(action: () => void): void {
    this.notificationDepth += 1
    try {
      action()
    } finally {
      this.notificationDepth -= 1
      if (this.notificationDepth === 0 && this.hasPendingNotification) {
        this.hasPendingNotification = false
        this.emitChange()
      }
    }
  }

  private notifyChanged(): void {
    if (this.notificationDepth > 0) {
      this.hasPendingNotification = true
      return
    }

    this.emitChange()
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
