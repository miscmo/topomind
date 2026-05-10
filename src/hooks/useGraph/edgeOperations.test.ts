import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { buildEdgeOperations, type EdgeOperationsDeps } from './edgeOperations'

vi.mock('../../core/log-backend', () => ({
  logAction: vi.fn(async () => true),
}))

function makeNode(id: string): KnowledgeNode {
  return {
    id,
    type: 'knowledgeCard',
    position: { x: 0, y: 0 },
    data: { label: id, path: id, hasChildren: false, nodeType: 'leaf' },
  }
}

function makeEdge(id: string): KnowledgeEdge {
  return {
    id,
    source: 'A',
    target: 'B',
    data: { relation: '相关', weight: 'minor', color: '#7f8c8d' },
  }
}

function createDeps(overrides: Partial<EdgeOperationsDeps> = {}) {
  const nodes = [makeNode('A'), makeNode('B')]
  const edgesRef = { current: [makeEdge('e1')] }
  const rebuildMaps = vi.fn()
  const scheduleSave = vi.fn()
  const setState = vi.fn((updater) => {
    const next = updater({ nodes, edges: edgesRef.current })
    edgesRef.current = next.edges
  }) as EdgeOperationsDeps['setState']
  const deps: EdgeOperationsDeps = {
    edgesRef,
    getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB', roomName: 'KB' }),
    rebuildMaps,
    scheduleSave,
    setState,
    ...overrides,
  }

  return { deps, edgesRef, rebuildMaps, scheduleSave }
}

describe('edgeOperations', () => {
  it('adds an edge with default style and schedules save', () => {
    const { deps, edgesRef, scheduleSave, rebuildMaps } = createDeps()
    const ops = buildEdgeOperations(deps)

    ops.addEdge(
      { source: 'A', target: 'B', sourceHandle: null, targetHandle: null },
      'e2',
      { lineMode: 'straight', lineStyle: 'dashed', color: '#123456', arrow: false }
    )

    expect(edgesRef.current[1]).toMatchObject({
      id: 'e2',
      source: 'A',
      target: 'B',
      type: 'straight',
      style: { stroke: '#123456', strokeDasharray: '6 4' },
      markerEnd: undefined,
      data: { lineMode: 'straight', lineStyle: 'dashed', color: '#123456', arrow: false },
    })
    expect(rebuildMaps).toHaveBeenCalled()
    expect(scheduleSave).toHaveBeenCalledWith('KB')
  })

  it('updates edge style and preserves relation defaults', () => {
    const { deps, edgesRef, scheduleSave } = createDeps()
    const ops = buildEdgeOperations(deps)

    ops.updateEdgeStyle('e1', { color: '#abcdef', lineStyle: 'dashed', selected: true })

    expect(edgesRef.current[0]).toMatchObject({
      id: 'e1',
      style: {
        stroke: '#abcdef',
        strokeWidth: 3.5,
        strokeDasharray: '6 4',
        filter: 'drop-shadow(0 0 6px rgba(52, 152, 219, 0.45))',
      },
      data: {
        relation: '相关',
        weight: 'minor',
        color: '#abcdef',
        lineStyle: 'dashed',
        selected: true,
      },
    })
    expect(scheduleSave).toHaveBeenCalledWith('KB')
  })

  it('deletes an edge and schedules save only when in a room', () => {
    const { deps, edgesRef, scheduleSave } = createDeps({
      getActiveNavState: () => ({ kbPath: 'KB', roomPath: '', roomName: 'KB' }),
    })
    const ops = buildEdgeOperations(deps)

    ops.deleteEdge('e1')

    expect(edgesRef.current).toEqual([])
    expect(scheduleSave).not.toHaveBeenCalled()
  })
})
