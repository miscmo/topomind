import { describe, expect, it, vi } from 'vitest'
import { createStore } from './service'
import type { StorageAdapter } from './adapter'
import type { GraphMeta } from './adapter/graph'

function createAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    createVault: vi.fn(),
    isValidVault: vi.fn(),
    removeVault: vi.fn(),
    listKBS: vi.fn(),
    createKB: vi.fn(),
    deleteKB: vi.fn(),
    renameKB: vi.fn(),
    importKB: vi.fn(),
    listCards: vi.fn(),
    createCard: vi.fn(),
    deleteCard: vi.fn(),
    renameCard: vi.fn(),
    countSubCards: vi.fn(),
    readCardMarkdown: vi.fn(),
    writeCardMarkdown: vi.fn(),
    readCardLayout: vi.fn(),
    writeCardLayout: vi.fn(),
    readAppConfig: vi.fn(),
    writeAppConfig: vi.fn(),
    ...overrides,
  } as StorageAdapter
}

describe('storage service graph normalization', () => {
  it('normalizes graph metadata read from the adapter', async () => {
    const adapter = createAdapter({
      readCardLayout: vi.fn(async () => ({
        nodes: {
          A: { card: { ref: 'A', name: 'A' }, width: Number.NaN, height: 150 },
        },
        edges: [{ id: '', source: { ref: 'A' }, target: { ref: 'B' } }],
        viewport: { zoom: Number.POSITIVE_INFINITY, pan: { x: 2, y: 3 } },
      }) as unknown as GraphMeta),
    })
    const store = createStore(adapter)

    const meta = await store.readLayout('KB')

    expect(meta.nodes.A.width).toBe(200)
    expect(meta.edges).toEqual([])
    expect(meta.viewport).toEqual({ zoom: 1, pan: { x: 2, y: 3 } })
  })

  it('normalizes graph metadata before writing through the adapter', async () => {
    const writeCardLayout = vi.fn(async () => undefined)
    const adapter = createAdapter({ writeCardLayout })
    const store = createStore(adapter)

    await store.writeLayout('KB', {
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'A' }, width: Number.NaN, height: 150 },
      },
      edges: [{ id: '', source: { ref: 'A', name: '' }, target: { ref: 'B', name: '' }, relation: '相关', weight: 'minor' }],
      viewport: { zoom: Number.NaN, pan: { x: 0, y: 0 } },
    })

    expect(writeCardLayout).toHaveBeenCalledWith('KB', {
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'A', updatedAt: undefined }, width: 200, height: 150, position: undefined },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    })
  })
})
