import { toDisposable } from '../public/disposables.ts'
import type { ActivationReason } from '../public/plugin'
import type { PluginManifest } from '../public/manifest'
import type { PluginSnapshot, PluginState } from './pluginTypes'

const allowedTransitions: Record<PluginState, PluginState[]> = {
  disabled: ['discovered'],
  discovered: ['validated', 'failed'],
  validated: ['indexed', 'failed'],
  indexed: ['waiting', 'failed'],
  waiting: ['activating', 'disabled', 'failed'],
  loaded: ['activating', 'failed'],
  activating: ['running', 'failed'],
  running: ['deactivated', 'failed', 'disabled'],
  deactivated: ['waiting', 'disabled', 'failed'],
  failed: ['waiting', 'disabled'],
}

function canTransition(current: PluginState | undefined, next: PluginState): boolean {
  if (!current) {
    return next === 'discovered'
  }

  return allowedTransitions[current]?.includes(next) ?? false
}

export class PluginLifecycle {
  private readonly snapshots = new Map<string, PluginSnapshot>()
  private readonly listeners = new Set<() => void>()

  registerDiscovered(manifest: PluginManifest): void {
    if (this.snapshots.has(manifest.id)) {
      throw new Error(`Plugin already discovered: ${manifest.id}`)
    }

    this.snapshots.set(manifest.id, {
      pluginId: manifest.id,
      manifest,
      state: 'discovered',
    })
    this.emitChange()
  }

  setState(
    pluginId: string,
    next: PluginState,
    options?: { activationReason?: ActivationReason; error?: unknown },
  ): void {
    const snapshot = this.snapshots.get(pluginId)

    if (!snapshot) {
      throw new Error(`Unknown plugin lifecycle entry: ${pluginId}`)
    }

    if (!canTransition(snapshot.state, next)) {
      throw new Error(`Invalid plugin state transition: ${snapshot.state} -> ${next} (${pluginId})`)
    }

    snapshot.state = next

    if (options?.activationReason) {
      snapshot.lastActivationReason = options.activationReason
    }

    if (options?.error) {
      snapshot.lastErrorMessage =
        options.error instanceof Error ? options.error.message : String(options.error)
      snapshot.lastFailedAt = new Date().toISOString()
    }

    this.emitChange()
  }

  getState(pluginId: string): PluginState | undefined {
    return this.snapshots.get(pluginId)?.state
  }

  getSnapshot(pluginId: string): PluginSnapshot | undefined {
    return this.snapshots.get(pluginId)
  }

  listSnapshots(): PluginSnapshot[] {
    return [...this.snapshots.values()]
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return toDisposable(() => {
      this.listeners.delete(listener)
    })
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
