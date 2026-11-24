import { toDisposable } from '../public/disposables.ts'
import type { ActivationReason } from '../public/plugin'
import type { PluginManifest } from '../public/manifest'
import type { PluginSnapshot, PluginState } from './pluginTypes'
import { recordInternal } from '../../core/observe.ts'
import { LOG_ACTIONS } from '../../shared/observability/logContract.ts'

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

    const previousState = snapshot.state
    snapshot.state = next

    if (options?.activationReason) {
      snapshot.lastActivationReason = options.activationReason
    }

    if (options?.error) {
      snapshot.lastErrorMessage =
        options.error instanceof Error ? options.error.message : String(options.error)
      snapshot.lastFailedAt = new Date().toISOString()
    }

    // P2 单点拦截：状态迁移是插件系统此前完全静默的部分。日志失败不能
    // 影响状态机本身，因此这里吞掉采集异常（emitChange 仍照常执行）。
    // P4：进入 running / 退回 deactivated·disabled 时改用语义化事件 id，
    // 让事件目录里的 plugin.activate / plugin.deactivate 真正有产生点，
    // 其余中间态仍走通用的 plugin.state（不额外增加日志条数）。
    const action = next === 'running'
      ? LOG_ACTIONS.pluginActivate
      : (next === 'deactivated' || next === 'disabled')
        ? LOG_ACTIONS.pluginDeactivate
        : LOG_ACTIONS.pluginState
    try {
      void recordInternal({
        action,
        level: next === 'failed' ? 'ERROR' : 'INFO',
        message: `插件状态迁移 ${previousState} → ${next}`,
        source: 'plugin-lifecycle',
        outcome: next === 'failed' ? 'failure' : next,
        params: {
          pluginId,
          from: previousState,
          to: next,
          ...(options?.activationReason ? { activationReason: options.activationReason } : {}),
        },
        ...(options?.error ? { error: options.error } : {}),
      })
    } catch {
      // 采集层异常不影响插件状态迁移。
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
