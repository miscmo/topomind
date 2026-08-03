import { logAction } from '../../core/log-backend.ts'

export interface SaveCoordinatorOptions<T> {
  delayMs: number
  save: (key: string, value: T) => Promise<void>
  onError?: (error: unknown, key: string) => void
}

interface PendingSave<T> {
  timer: ReturnType<typeof setTimeout> | null
  buildValue: () => T
  version: number
  inFlight: Promise<void> | null
  onSavedCallbacks: Set<() => void>
  scheduledResolvers: Array<() => void>
}

export class SaveCoordinator<T> {
  private readonly delayMs: number
  private readonly save: (key: string, value: T) => Promise<void>
  private readonly onError?: (error: unknown, key: string) => void
  private readonly pending = new Map<string, PendingSave<T>>()

  constructor(options: SaveCoordinatorOptions<T>) {
    this.delayMs = options.delayMs
    this.save = options.save
    this.onError = options.onError
  }

  schedule(key: string, buildValue: () => T, onSaved?: () => void): Promise<void> {
    if (!key) return Promise.resolve()

    const pending = this.getOrCreatePending(key, buildValue)
    pending.buildValue = buildValue
    pending.version += 1
    if (onSaved) pending.onSavedCallbacks.add(onSaved)

    const scheduled = new Promise<void>((resolve) => {
      pending.scheduledResolvers.push(resolve)
    })

    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      pending.timer = null
      void this.runPending(key, { swallowErrors: true })
    }, this.delayMs)

    return scheduled
  }

  async flush(key: string, buildValue: () => T, onSaved?: () => void): Promise<void> {
    if (!key) return

    const pending = this.getOrCreatePending(key, buildValue)
    pending.buildValue = buildValue
    pending.version += 1
    if (onSaved) pending.onSavedCallbacks.add(onSaved)

    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }

    while (this.pending.has(key)) {
      const current = this.pending.get(key)
      if (!current) return
      if (current.inFlight) {
        await current.inFlight
        continue
      }
      await this.runPending(key, { swallowErrors: false })
    }
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
      version: 0,
      inFlight: null,
      onSavedCallbacks: new Set(),
      scheduledResolvers: [],
    }
    this.pending.set(key, pending)
    return pending
  }

  private async runPending(key: string, options: { swallowErrors: boolean }): Promise<void> {
    const pending = this.pending.get(key)
    if (!pending) return
    if (pending.inFlight) {
      try {
        await pending.inFlight
      } catch (error) {
        if (!options.swallowErrors) throw error
      }
      return
    }

    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }

    const version = pending.version
    const value = pending.buildValue()
    let savePromise!: Promise<void>
    savePromise = (async () => {
      try {
        await this.save(key, value)
        if (this.pending.get(key) === pending && pending.version === version) {
          this.pending.delete(key)
          const callbacks = Array.from(pending.onSavedCallbacks)
          pending.onSavedCallbacks.clear()
          this.resolveScheduled(pending)
          for (const callback of callbacks) callback()
        }
      } catch (error) {
        this.onError?.(error, key)
        if (typeof window !== 'undefined') {
          logAction('SaveCoordinator:保存失败', 'SaveCoordinator', {
            key,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        // Keep the entry dirty so close guard or a later schedule can retry it.
        // Debounced callers are notified that this attempt finished; explicit
        // flush callers receive the error and can cancel navigation/closing.
        if (this.pending.get(key) === pending) this.resolveScheduled(pending)
        throw error
      } finally {
        if (pending.inFlight === savePromise) pending.inFlight = null
      }
    })()
    pending.inFlight = savePromise

    try {
      await savePromise
    } catch (error) {
      if (!options.swallowErrors) throw error
    }
  }

  private resolveScheduled(pending: PendingSave<T>): void {
    for (const resolve of pending.scheduledResolvers) resolve()
    pending.scheduledResolvers = []
  }
}
