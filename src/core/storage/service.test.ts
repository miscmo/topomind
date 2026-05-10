import { describe, expect, it, vi } from 'vitest'
import { createStore } from './service'
import type { GraphMeta, StorageBackend } from './types'

function createBackend(overrides: Partial<StorageBackend> = {}): StorageBackend {
  return {
    createVault: vi.fn(),
    isValidVault: vi.fn(),
    removeVault: vi.fn(),
    listKBs: vi.fn(),
    createKB: vi.fn(),
    deleteKB: vi.fn(),
    renameKB: vi.fn(),
    importKB: vi.fn(),
    listCards: vi.fn(),
    createCard: vi.fn(),
    deleteCard: vi.fn(),
    renameCard: vi.fn(),
    countChildren: vi.fn(),
    readMarkdown: vi.fn(),
    writeMarkdown: vi.fn(),
    readLayout: vi.fn(),
    writeLayout: vi.fn(),
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
    ...overrides,
  } as StorageBackend
}

describe('storage service graph normalization', () => {
  it('normalizes graph metadata read from the adapter', async () => {
    const backend = createBackend({
      readLayout: vi.fn(async () => ({
        nodes: {
          A: { card: { ref: 'A', name: 'A' }, width: Number.NaN, height: 150 },
        },
        edges: [{ id: '', source: { ref: 'A' }, target: { ref: 'B' } }],
        viewport: { zoom: Number.POSITIVE_INFINITY, pan: { x: 2, y: 3 } },
      }) as unknown as GraphMeta),
    })
    const store = createStore(backend)

    const meta = await store.readLayout('KB')

    expect(meta.nodes.A.width).toBe(200)
    expect(meta.edges).toEqual([])
    expect(meta.viewport).toEqual({ zoom: 1, pan: { x: 2, y: 3 } })
  })

  it('normalizes graph metadata before writing through the adapter', async () => {
    const writeLayout = vi.fn(async () => undefined)
    const backend = createBackend({ writeLayout })
    const store = createStore(backend)

    await store.writeLayout('KB', {
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'A' }, width: Number.NaN, height: 150 },
      },
      edges: [{ id: '', source: { ref: 'A', name: '' }, target: { ref: 'B', name: '' }, relation: '相关', weight: 'minor' }],
      viewport: { zoom: Number.NaN, pan: { x: 0, y: 0 } },
    })

    expect(writeLayout).toHaveBeenCalledWith('KB', {
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'A', updatedAt: undefined }, width: 200, height: 150, position: undefined },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    })
  })
})
