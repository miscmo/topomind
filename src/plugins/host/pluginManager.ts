import { disposeAll } from '../public/disposables.ts'
import type { Disposable } from '../public/disposables'
import type {
  ActivationReason,
  PluginContext,
  TopoMindPluginModule,
} from '../public/plugin'
import type { PluginActivationEvent, PluginManifest } from '../public/manifest'
import { BuiltinPluginLoader } from '../runtime/builtinPluginLoader.ts'
import { createPluginContext, type PluginHostServices } from './pluginContext.ts'
import { PluginLifecycle } from './pluginLifecycle.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import type { BuiltinPluginDescriptor, PluginDiagnostics, PluginSnapshot } from './pluginTypes'

interface LoadedPlugin {
  descriptor: BuiltinPluginDescriptor
  module: TopoMindPluginModule
  context: PluginContext
}

function toActivationEvent(reason: ActivationReason): PluginActivationEvent {
  switch (reason.type) {
    case 'app-ready':
      return 'onAppReady'
    case 'workspace-ready':
      return 'onWorkspaceReady'
    case 'command':
      return `onCommand:${reason.commandId}`
    case 'view':
      return `onViewOpen:${reason.viewId}`
  }
}

function assertActivationAllowed(manifest: PluginManifest, reason: ActivationReason): void {
  const activationEvent = toActivationEvent(reason)

  if (!manifest.activationEvents.includes(activationEvent)) {
    throw new Error(
      `Plugin ${manifest.id} cannot be activated by ${activationEvent}; declare it in manifest.activationEvents first`,
    )
  }
}

export class PluginManager {
  private readonly loader: BuiltinPluginLoader
  private readonly registry: PluginRegistry
  private readonly lifecycle: PluginLifecycle
  private readonly hostServices?: Partial<PluginHostServices>
  private readonly descriptorsByPluginId = new Map<string, BuiltinPluginDescriptor>()
  private readonly loadedPluginsByPluginId = new Map<string, LoadedPlugin>()
  private readonly activationPromises = new Map<string, Promise<void>>()
  private discovered = false

  constructor(input?: {
    loader?: BuiltinPluginLoader
    registry?: PluginRegistry
    lifecycle?: PluginLifecycle
    hostServices?: Partial<PluginHostServices>
  }) {
    this.loader = input?.loader ?? new BuiltinPluginLoader()
    this.registry = input?.registry ?? new PluginRegistry()
    this.lifecycle = input?.lifecycle ?? new PluginLifecycle()
    this.hostServices = input?.hostServices
  }

  discover(): void {
    if (this.discovered) {
      return
    }

    for (const descriptor of this.loader.list()) {
      this.descriptorsByPluginId.set(descriptor.manifest.id, descriptor)
      this.lifecycle.registerDiscovered(descriptor.manifest)
      this.lifecycle.setState(descriptor.manifest.id, 'validated')
      this.registry.indexManifest(descriptor.manifest)
      this.lifecycle.setState(descriptor.manifest.id, 'indexed')
      this.lifecycle.setState(descriptor.manifest.id, 'waiting')
    }

    this.discovered = true
  }

  getRegistry(): PluginRegistry {
    return this.registry
  }

  getPluginState(pluginId: string) {
    return this.lifecycle.getState(pluginId)
  }

  getPluginSnapshot(pluginId: string): PluginSnapshot | undefined {
    return this.lifecycle.getSnapshot(pluginId)
  }

  getPluginDiagnostics(pluginId: string): PluginDiagnostics | undefined {
    const snapshot = this.lifecycle.getSnapshot(pluginId)
    if (!snapshot) {
      return undefined
    }

    return {
      ...snapshot,
      runtimeRecords: this.registry.listRuntimeRecords(pluginId),
    }
  }

  listPlugins(): PluginSnapshot[] {
    return this.lifecycle.listSnapshots()
  }

  listPluginDiagnostics(): PluginDiagnostics[] {
    return this.listPlugins().map((snapshot) => ({
      ...snapshot,
      runtimeRecords: this.registry.listRuntimeRecords(snapshot.pluginId),
    }))
  }

  subscribeDiagnostics(listener: (diagnostics: PluginDiagnostics[]) => void): Disposable {
    const emitDiagnostics = () => {
      listener(this.listPluginDiagnostics())
    }

    emitDiagnostics()

    const subscriptions = [
      this.lifecycle.subscribe(emitDiagnostics),
      this.registry.subscribe(emitDiagnostics),
    ]

    return {
      dispose: () => {
        disposeAll(subscriptions)
      },
    }
  }

  async activateByReason(activationReason: ActivationReason): Promise<void> {
    this.discover()

    const activationEvent = toActivationEvent(activationReason)
    const pluginIds = this.registry
      .listManifests()
      .filter((manifest) => manifest.activationEvents.includes(activationEvent))
      .map((manifest) => manifest.id)

    await Promise.all(pluginIds.map((pluginId) => this.ensureActivated(pluginId, activationReason)))
  }

  async ensureActivated(pluginId: string, activationReason: ActivationReason): Promise<void> {
    this.discover()

    const currentState = this.lifecycle.getState(pluginId)

    if (currentState === 'running') {
      return
    }

    if (currentState === 'disabled') {
      throw new Error(`Plugin is disabled: ${pluginId}`)
    }

    if (currentState === 'failed' || currentState === 'deactivated') {
      this.lifecycle.setState(pluginId, 'waiting')
    }

    const inFlight = this.activationPromises.get(pluginId)
    if (inFlight) {
      await inFlight
      return
    }

    const activation = this.activateOnce(pluginId, activationReason)
    this.activationPromises.set(pluginId, activation)

    try {
      await activation
    } finally {
      this.activationPromises.delete(pluginId)
    }
  }

  async executeCommand(commandId: string, args?: unknown): Promise<void> {
    this.discover()

    let handler = this.registry.getCommandHandler(commandId)
    if (!handler) {
      const staticRecord = this.registry.getStaticCommand(commandId)
      if (!staticRecord) {
        throw new Error(`Unknown command: ${commandId}`)
      }

      await this.ensureActivated(staticRecord.pluginId, { type: 'command', commandId })
      handler = this.registry.getCommandHandler(commandId)
    }

    if (!handler) {
      throw new Error(`Command is not bound: ${commandId}`)
    }

    await handler(args)
  }

  async deactivate(pluginId: string): Promise<void> {
    const loaded = this.loadedPluginsByPluginId.get(pluginId)
    if (!loaded) {
      return
    }

    await loaded.module.deactivate?.()
    disposeAll(loaded.context.subscriptions)
    this.registry.clearRuntimeBindings(pluginId)
    this.loadedPluginsByPluginId.delete(pluginId)
    this.lifecycle.setState(pluginId, 'deactivated')
  }

  async disable(pluginId: string): Promise<void> {
    const currentState = this.lifecycle.getState(pluginId)

    if (currentState === 'running') {
      await this.deactivate(pluginId)
      this.lifecycle.setState(pluginId, 'disabled')
      return
    }

    if (currentState === 'waiting' || currentState === 'failed' || currentState === 'deactivated') {
      this.lifecycle.setState(pluginId, 'disabled')
      return
    }

    throw new Error(`Plugin cannot be disabled from state: ${currentState ?? 'unknown'}`)
  }

  private async activateOnce(pluginId: string, activationReason: ActivationReason): Promise<void> {
    const descriptor = this.descriptorsByPluginId.get(pluginId)
    if (!descriptor) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }

    try {
      assertActivationAllowed(descriptor.manifest, activationReason)
      this.lifecycle.setState(pluginId, 'activating', { activationReason })
      const module = await descriptor.loadModule()
      const context = createPluginContext({
        manifest: descriptor.manifest,
        activationReason,
        registry: this.registry,
        hostServices: this.hostServices,
      })

      await module.activate(context)

      this.loadedPluginsByPluginId.set(pluginId, {
        descriptor,
        module,
        context,
      })
      this.lifecycle.setState(pluginId, 'running', { activationReason })
    } catch (error) {
      this.registry.clearRuntimeBindings(pluginId, { preserveFailedRecords: true })
      this.lifecycle.setState(pluginId, 'failed', { activationReason, error })
      throw error
    }
  }
}
