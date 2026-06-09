import { logAction } from '../../core/log-backend'

export interface SaveCoordinatorOptions<T> {
  delayMs: number
  save: (key: string, value: T) => Promise<void>
  onError?: (error: unknown, key: string) => void
}

interface PendingSave<T> {
  timer: ReturnType<typeof setTimeout> | null
  buildValue: () => T
  onSavedCallbacks: Set<() => void>
  scheduledResolvers: Array<() => void>
}

export class SaveCoordinator<T> {
  private readonly delayMs: number
  private readonly save: (key: string, value: T) => Promise<void>
  private readonly onError?: (error: unknown, key: string) => void
  private readonly pending = new Map<string, PendingSave<T>>()
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(options: SaveCoordinatorOptions<T>) {
    this.delayMs = options.delayMs
    this.save = options.save
    this.onError = options.onError
  }

  schedule(key: string, buildValue: () => T, onSaved?: () => void): Promise<void> {
    if (!key) return Promise.resolve()

    const pending = this.preparePending(key, buildValue, onSaved)

    const scheduled = new Promise<void>((resolve) => {
      pending.scheduledResolvers.push(resolve)
    })

    this.restartTimer(key, pending)
    return scheduled
  }

  touch(key: string, buildValue: () => T, onSaved?: () => void): void {
    if (!key) return
    const pending = this.preparePending(key, buildValue, onSaved)
    this.restartTimer(key, pending)
  }

  async flush(key: string, buildValue: () => T, onSaved?: () => void): Promise<void> {
    if (!key) return

    const pending = this.getOrCreatePending(key, buildValue)
    pending.buildValue = buildValue
    if (onSaved) pending.onSavedCallbacks.add(onSaved)

    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }

    await this.runPending(key, { swallowErrors: false })
  }

  hasPending(key: string): boolean {
    return this.pending.has(key)
  }

  clear(key: string): void {
    const pending = this.pending.get(key)
    if (!pending) return
    if (pending.timer) clearTimeout(pending.timer)
    this.resolveScheduled(pending)
    this.pending.delete(key)
  }

  clearAll(): void {
    for (const key of this.pending.keys()) {
      this.clear(key)
    }
  }

  private getOrCreatePending(key: string, buildValue: () => T): PendingSave<T> {
    const existing = this.pending.get(key)
    if (existing) return existing

    const pending: PendingSave<T> = {
      timer: null,
      buildValue,
      onSavedCallbacks: new Set(),
      scheduledResolvers: [],
    }
    this.pending.set(key, pending)
    return pending
  }

  private preparePending(key: string, buildValue: () => T, onSaved?: () => void): PendingSave<T> {
    const pending = this.getOrCreatePending(key, buildValue)
    pending.buildValue = buildValue
    if (onSaved) pending.onSavedCallbacks.add(onSaved)
    return pending
  }

  private restartTimer(key: string, pending: PendingSave<T>): void {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      void this.runPending(key, { swallowErrors: true })
    }, this.delayMs)
  }

  private async runPending(key: string, options: { swallowErrors: boolean }): Promise<void> {
    const pending = this.pending.get(key)
    if (!pending) return

    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }

    this.pending.delete(key)

    const previousRun = this.inFlight.get(key)
    const currentRun = (async () => {
      if (previousRun) {
        await previousRun.catch(() => undefined)
      }

      try {
        await this.save(key, pending.buildValue())
        for (const callback of pending.onSavedCallbacks) callback()
      } catch (error) {
        this.onError?.(error, key)
        logAction('SaveCoordinator:保存失败', 'SaveCoordinator', { key, error: error instanceof Error ? error.message : String(error) })
        if (!options.swallowErrors) {
          throw error
        }
      } finally {
        this.resolveScheduled(pending)
      }
    })()

    this.inFlight.set(key, currentRun)

    try {
      await currentRun
    } finally {
      if (this.inFlight.get(key) === currentRun) {
        this.inFlight.delete(key)
      }
    }
  }

  private resolveScheduled(pending: PendingSave<T>): void {
    for (const resolve of pending.scheduledResolvers) resolve()
    pending.scheduledResolvers = []
  }
}
