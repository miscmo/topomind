import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveCoordinator } from './saveCoordinator'

describe('SaveCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces scheduled saves and persists the latest value', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (_key: string, _value: number) => {})
    const onSaved = vi.fn()
    const coordinator = new SaveCoordinator<number>({ delayMs: 300, save })

    const first = coordinator.schedule('room', () => 1, onSaved)
    const second = coordinator.schedule('room', () => 2, onSaved)

    await vi.advanceTimersByTimeAsync(299)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([first, second])

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('room', 2)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(coordinator.hasPending('room')).toBe(false)
  })

  it('flushes immediately and cancels pending debounce timer', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (_key: string, _value: string) => {})
    const coordinator = new SaveCoordinator<string>({ delayMs: 300, save })

    const scheduled = coordinator.schedule('room', () => 'scheduled')
    await coordinator.flush('room', () => 'flushed')
    await scheduled
    await vi.advanceTimersByTimeAsync(300)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('room', 'flushed')
    expect(coordinator.hasPending('room')).toBe(false)
  })

  it('propagates flush errors while resolving scheduled waiters', async () => {
    vi.useFakeTimers()
    const error = new Error('disk full')
    const save = vi.fn(async (_key: string, _value: string) => {
      throw error
    })
    const onError = vi.fn()
    const coordinator = new SaveCoordinator<string>({ delayMs: 300, save, onError })

    const scheduled = coordinator.schedule('room', () => 'scheduled')

    await expect(coordinator.flush('room', () => 'flushed')).rejects.toThrow('disk full')
    await scheduled

    expect(onError).toHaveBeenCalledWith(error, 'room')
    expect(coordinator.hasPending('room')).toBe(false)
  })

  it('swallows scheduled save errors and reports them', async () => {
    vi.useFakeTimers()
    const error = new Error('disk full')
    const save = vi.fn(async (_key: string, _value: string) => {
      throw error
    })
    const onError = vi.fn()
    const coordinator = new SaveCoordinator<string>({ delayMs: 300, save, onError })

    const scheduled = coordinator.schedule('room', () => 'scheduled')
    await vi.advanceTimersByTimeAsync(300)
    await scheduled

    expect(onError).toHaveBeenCalledWith(error, 'room')
    expect(coordinator.hasPending('room')).toBe(false)
  })
})
