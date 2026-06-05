import type { ReactNode } from 'react'

import type { SecondaryViewRendererProps, WidgetRendererProps } from '../public/api'
import type { Disposable } from '../public/disposables'
import type { ActivationReason, TopoMindPluginModule } from '../public/plugin'
import type { PluginManifest } from '../public/manifest'

export type ContributionType = 'view' | 'command' | 'widget' | 'setting' | 'analytics'

export type PluginState =
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

export interface StaticContributionRecord {
  pluginId: string
  contributionType: ContributionType
  contributionId: string
  activationEvents: string[]
  manifestData: Record<string, unknown>
}

export interface RuntimeBindingRecord {
  pluginId: string
  contributionType: Exclude<ContributionType, 'setting'>
  contributionId: string
  status: 'pending' | 'bound' | 'failed'
  disposable?: Disposable
  errorMessage?: string
}

export interface RuntimeViewBinding {
  viewId: string
  pluginId: string
  render: (props: SecondaryViewRendererProps) => ReactNode
  disposable: Disposable
}

export interface RuntimeCommandBinding {
  commandId: string
  pluginId: string
  execute: (args?: unknown) => void | Promise<void>
  disposable: Disposable
}

export interface RuntimeWidgetBinding {
  widgetId: string
  pluginId: string
  placement: 'titlebar' | 'home'
  render: (props: WidgetRendererProps) => ReactNode
  disposable: Disposable
}

export interface BuiltinPluginDescriptor {
  manifest: PluginManifest
  loadModule: () => Promise<TopoMindPluginModule>
}

export interface PluginSnapshot {
  pluginId: string
  manifest: PluginManifest
  state: PluginState
  lastActivationReason?: ActivationReason
  lastErrorMessage?: string
  lastFailedAt?: string
}

export interface PluginDiagnostics extends PluginSnapshot {
  runtimeRecords: RuntimeBindingRecord[]
}
