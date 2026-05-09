import { describe, expect, it } from 'vitest'
import { normalizeGraphMeta } from './normalizeGraphMeta'

describe('normalizeGraphMeta', () => {
  it('returns an empty valid graph for invalid input', () => {
    expect(normalizeGraphMeta(null)).toEqual({
      nodes: {},
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    })
  })

  it('normalizes nodes and viewport fields', () => {
    const meta = normalizeGraphMeta({
      nodes: {
        A: {
          card: { ref: 'A', name: 'Alpha' },
          width: Number.NaN,
          height: 180,
          position: { x: 12, y: 'bad' },
        },
      },
      viewport: { zoom: Number.POSITIVE_INFINITY, pan: { x: 1, y: 2 } },
    })

    expect(meta.nodes.A).toMatchObject({
      id: 'A',
      card: { ref: 'A', name: 'Alpha' },
      width: 200,
      height: 180,
      position: { x: 12, y: 0 },
    })
    expect(meta.viewport).toEqual({ zoom: 1, pan: { x: 1, y: 2 } })
  })

  it('drops duplicate and incomplete edges without pruning path-style references', () => {
    const meta = normalizeGraphMeta({
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'A' }, width: 200, height: 150 },
        B: { id: 'B', card: { ref: 'B', name: 'B' }, width: 200, height: 150 },
      },
      edges: [
        { id: 'e1', source: { ref: 'A' }, target: { ref: 'B' }, relation: '依赖', weight: 'main' },
        { id: 'e1', source: { ref: 'A' }, target: { ref: 'B' } },
        { id: 'e2', source: { ref: 'KB/A' }, target: { ref: 'KB/Missing' } },
        { id: 'e3', source: { ref: '' }, target: { ref: 'B' } },
      ],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    })

    expect(meta.edges).toHaveLength(2)
    expect(meta.edges[0]).toMatchObject({
      id: 'e1',
      source: { ref: 'A' },
      target: { ref: 'B' },
      relation: '依赖',
      weight: 'main',
    })
    expect(meta.edges[1]).toMatchObject({
      id: 'e2',
      source: { ref: 'KB/A' },
      target: { ref: 'KB/Missing' },
      relation: '相关',
      weight: 'minor',
    })
  })
})
