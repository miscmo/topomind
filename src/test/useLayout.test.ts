/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeLayoutImpl } from '../hooks/useLayout'
import { LAYOUT } from '../types'
import type { ELKGraph } from '../types/elk.d'

// Mock log-backend to prevent IPC errors
vi.mock('../core/log-backend', () => ({
  logAction: vi.fn(),
}))

// Mock logger
vi.mock('../core/logger', () => ({
  logger: { catch: vi.fn() },
}))

import type { Node } from '@xyflow/react'

describe('computeLayoutImpl', () => {
  let mockElk: { layout: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockElk = { layout: vi.fn() }
  })

  const makeNode = (id: string, parent?: string): Node => {
    const data: Record<string, unknown> = { label: id, path: id }
    if (parent) data['parent'] = parent
    return { id, data, position: { x: 0, y: 0 } } as unknown as Node
  }

  it('returns empty record for empty nodes array', async () => {
    const result = await computeLayoutImpl(mockElk as any, [], 'DOWN')
    expect(result).toEqual({})
  })

  it('returns empty record when ELK throws', async () => {
    mockElk.layout.mockRejectedValue(new Error('ELK error'))
    const result = await computeLayoutImpl(mockElk as any, [makeNode('n1')], 'DOWN')
    expect(result).toEqual({})
  })

  it('returns empty record when ELK result has no children', async () => {
    mockElk.layout.mockResolvedValue({ id: 'root', children: null } as unknown as import('../types/elk').ELKLayoutResult)
    const result = await computeLayoutImpl(mockElk as any, [makeNode('n1')], 'DOWN')
    expect(result).toEqual({})
  })

  it('returns positions from ELK result for DOWN direction', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'n1', x: 10, y: 20 },
        { id: 'n2', x: 30, y: 40 },
      ],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const result = await computeLayoutImpl(
      mockElk as any,
      [makeNode('n1'), makeNode('n2')],
      'DOWN'
    )

    expect(result).toEqual({ n1: { x: 10, y: 20 }, n2: { x: 30, y: 40 } })
  })

  it('returns positions from ELK result for RIGHT direction', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [{ id: 'n1', x: 100, y: 200 }],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const result = await computeLayoutImpl(mockElk as any, [makeNode('n1')], 'RIGHT')
    expect(result).toEqual({ n1: { x: 100, y: 200 } })
  })

  it('skips nodes with undefined x or y in ELK result', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'n1', x: 10, y: 20 },
        { id: 'n2', x: undefined, y: 40 },
        { id: 'n3', x: 50, y: undefined },
        { id: 'n4' },
      ],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const result = await computeLayoutImpl(
      mockElk as any,
      [makeNode('n1'), makeNode('n2'), makeNode('n3'), makeNode('n4')],
      'DOWN'
    )

    expect(Object.keys(result)).toEqual(['n1'])
    expect(result['n1']).toEqual({ x: 10, y: 20 })
  })

  it('uses measured dimensions when available, falls back to defaults', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [{ id: 'n1', x: 0, y: 0 }],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const nodes = [
      {
        id: 'n1',
        data: { label: 'Node1', path: 'n1' },
        position: { x: 0, y: 0 },
        measured: { width: 200, height: 100 },
        width: 180,
        height: 80,
      },
    ] as Node[]

    await computeLayoutImpl(mockElk as any, nodes, 'DOWN')

    const call = mockElk.layout.mock.calls[0] as [ELKGraph, any]
    // children may be undefined according to ELKGraph type — use toMatchObject to avoid index access
    expect(call[0].children).toBeDefined()
    expect(call[0].children![0]).toMatchObject({ width: 200, height: 100 })
  })

  it('defaults to width 180 height 80 when no measured dimensions', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [{ id: 'n1', x: 0, y: 0 }],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const nodes = [{ id: 'n1', data: { label: 'Node1', path: 'n1' }, position: { x: 0, y: 0 } }] as Node[]

    await computeLayoutImpl(mockElk as any, nodes, 'DOWN')

    const call = mockElk.layout.mock.calls[0] as [ELKGraph, any]
    expect(call[0].children).toBeDefined()
    expect(call[0].children![0]).toMatchObject({ width: 180, height: 80 })
  })

  it('passes parent-based edges to ELK for layout constraints', async () => {
    mockElk.layout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'parent', x: 0, y: 0 },
        { id: 'child', x: 0, y: 50 },
      ],
    } as unknown as import('../types/elk').ELKLayoutResult)

    const nodes: Node[] = [makeNode('parent'), makeNode('child', 'parent')]

    await computeLayoutImpl(mockElk as any, nodes, 'DOWN')

    const call = mockElk.layout.mock.calls[0] as [ELKGraph, any]
    expect(call[0].edges).toBeDefined()
    expect(call[0].edges!).toMatchObject([
      { id: 'e-parent-child', sources: ['parent'], targets: ['child'] },
    ])
  })

  it('passes correct layout direction to ELK', async () => {
    mockElk.layout.mockResolvedValue({ id: 'root', children: [] } as unknown as import('../types/elk').ELKLayoutResult)

    await computeLayoutImpl(mockElk as any, [makeNode('n1')], 'RIGHT')

    const call = mockElk.layout.mock.calls[0] as [ELKGraph, any]
    expect(call[0].layoutOptions).toBeDefined()
    expect(call[0].layoutOptions!['elk.direction']).toBe('RIGHT')
  })

  it('uses MIN_SPACING when node count large enough to reduce spacing below MIN_SPACING', async () => {
    mockElk.layout.mockResolvedValue({ id: 'root', children: [] } as unknown as import('../types/elk').ELKLayoutResult)

    const manyNodes = Array.from({ length: 200 }, (_, i) => makeNode(`n${i}`)) as Node[]

    await computeLayoutImpl(mockElk as any, manyNodes, 'DOWN')

    const call = mockElk.layout.mock.calls[0] as [ELKGraph, any]
    expect(call[0].layoutOptions).toBeDefined()
    expect(call[0].layoutOptions!['elk.spacing.nodeNode']).toBe(LAYOUT.MIN_SPACING)
  })
})