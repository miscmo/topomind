import { describe, expect, it, vi } from 'vitest'
import type { GraphMeta } from '../../core/storage/adapter/graph'
import { loadRoomGraph, type RoomLoaderStorage } from './roomLoader'

function emptyMeta(): GraphMeta {
  return {
    nodes: {},
    edges: [],
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  }
}

function createStorage(layouts: Record<string, GraphMeta>, count = 0): RoomLoaderStorage {
  return {
    readLayout: vi.fn(async (dirPath: string) => {
      const layout = layouts[dirPath]
      if (!layout) throw new Error(`missing layout: ${dirPath}`)
      return layout
    }),
    countChildren: vi.fn(async () => count),
  }
}

describe('roomLoader', () => {
  it('loads room graph and applies child viewport as fallback position', async () => {
    const roomMeta: GraphMeta = {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'Child', name: 'Child' },
          width: 200,
          height: 150,
        },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }
    const storage = createStorage({
      KB: roomMeta,
      'KB/Child': {
        ...emptyMeta(),
        viewport: { zoom: 1, pan: { x: 123, y: 456 } },
      },
    })

    const loaded = await loadRoomGraph(storage, 'KB', 'KB')

    expect(loaded.savedPositions).toEqual({ 'KB/Child': { x: 123, y: 456 } })
    expect(loaded.nodes[0]).toMatchObject({
      id: 'KB/Child',
      position: { x: 123, y: 456 },
      data: { path: 'KB/Child' },
    })
    expect(storage.readLayout).toHaveBeenCalledWith('KB/Child')
  })

  it('does not let missing child layouts block the room load', async () => {
    const roomMeta: GraphMeta = {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'Child', name: 'Child' },
          width: 200,
          height: 150,
        },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }
    const storage = createStorage({ KB: roomMeta })

    const loaded = await loadRoomGraph(storage, 'KB', 'KB')

    expect(loaded.savedPositions).toEqual({})
    expect(loaded.nodes[0].id).toBe('KB/Child')
    expect(loaded.nodes[0].position).toEqual({ x: 50, y: 50 })
  })

  it('builds edges with room-scoped endpoints', async () => {
    const storage = createStorage({
      KB: {
        nodes: {
          Child: {
            id: 'Child',
            card: { ref: 'Child', name: 'Child' },
            width: 200,
            height: 150,
          },
          Other: {
            id: 'KB/Other',
            card: { ref: 'KB/Other', name: 'Other' },
            width: 200,
            height: 150,
          },
        },
        edges: [
          {
            id: 'e1',
            source: { ref: 'Child', name: '' },
            target: { ref: 'KB/Other', name: '' },
            relation: '相关',
            weight: 'minor',
          },
        ],
        viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      },
    })

    const loaded = await loadRoomGraph(storage, 'KB', 'KB')

    expect(loaded.nodes.map((node) => node.id)).toEqual(['KB/Child', 'KB/Other'])
    expect(loaded.edges[0]).toMatchObject({ source: 'KB/Child', target: 'KB/Other' })
  })
})
