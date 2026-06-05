export { PluginManager } from './host/pluginManager'
export { PluginLifecycle } from './host/pluginLifecycle'
export { PluginViewHost } from './host/PluginViewHost'
export { PluginWidgetSlot } from './host/PluginWidgetSlot'
export { PluginRegistry } from './host/pluginRegistry'
export { BuiltinPluginLoader } from './runtime/builtinPluginLoader'
export { validatePluginManifest } from './host/pluginManifest'
export { bootstrapPlugins, getPluginManager } from './bootstrap'

export type {
  BuiltinPluginDescriptor,
  PluginDiagnostics,
  PluginSnapshot,
  PluginState,
  RuntimeBindingRecord,
  RuntimeCommandBinding,
  RuntimeViewBinding,
  RuntimeWidgetBinding,
  StaticContributionRecord,
} from './host/pluginTypes'
export type { PluginHostServices } from './host/pluginContext'
export * from './public'
