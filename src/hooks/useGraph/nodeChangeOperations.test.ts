import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { buildNodeChangeOperations, type NodeChangeOperationsDeps } from './nodeChangeOperations'

function makeNode(id: string): KnowledgeNode {
  return {
    id,
    type: 'knowledgeCard',
    position: { x: 0, y: 0 },
    data: { label: id, path: id, hasChildren: false, nodeType: 'leaf' },
  }
}

function makeEdge(id: string, source: string, target: string): KnowledgeEdge {
  return {
    id,
    source,
    target,
    data: { relation: '相关', weight: 'minor' },
  }
}

function createDeps(overrides: Partial<NodeChangeOperationsDeps> = {}) {
  const nodesRef = { current: [makeNode('A'), makeNode('B'), makeNode('C')] }
  const edgesRef = { current: [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')] }
  const rebuildMaps = vi.fn()
  const scheduleSave = vi.fn()
  const updateSelectedNode = vi.fn()
  const setState = vi.fn((updater) => {
    const next = updater({ nodes: nodesRef.current, edges: edgesRef.current })
    nodesRef.current = next.nodes
    edgesRef.current = next.edges
  }) as NodeChangeOperationsDeps['setState']
  const deps: NodeChangeOperationsDeps = {
    nodesRef,
    edgesRef,
    getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB', roomName: 'KB' }),
    getActiveSelectedNodeId: () => 'A',
    rebuildMaps,
    scheduleSave,
    setState,
    updateSelectedNode,
    ...overrides,
  }

  return { deps, nodesRef, edgesRef, rebuildMaps, scheduleSave, updateSelectedNode }
}

describe('nodeChangeOperations', () => {
  it('applies node position changes and syncs selected node', () => {
    const { deps, nodesRef, scheduleSave, updateSelectedNode } = createDeps()
    const ops = buildNodeChangeOperations(deps)

    ops.applyNodePositionChanges([{ id: 'A', position: { x: 10, y: 20 } }])

    expect(nodesRef.current[0].position).toEqual({ x: 10, y: 20 })
    expect(updateSelectedNode).toHaveBeenCalledWith(nodesRef.current, 'A')
    expect(scheduleSave).toHaveBeenCalledWith('KB')
  })

  it('removes nodes and prunes connected edges', () => {
    const { deps, nodesRef, edgesRef, rebuildMaps, scheduleSave } = createDeps()
    const ops = buildNodeChangeOperations(deps)

    ops.applyNodeRemoveChanges(['B'])

    expect(nodesRef.current.map((node) => node.id)).toEqual(['A', 'C'])
    expect(edgesRef.current).toEqual([])
    expect(rebuildMaps).toHaveBeenCalledWith(nodesRef.current, edgesRef.current)
    expect(scheduleSave).toHaveBeenCalledWith('KB')
  })

  it('updates measured dimensions without scheduling save', () => {
    const { deps, nodesRef, scheduleSave } = createDeps()
    const ops = buildNodeChangeOperations(deps)

    ops.applyNodeDimensionChanges([{ id: 'A', dimensions: { width: 100, height: 50 } }])

    expect(nodesRef.current[0].measured).toEqual({ width: 100, height: 50 })
    expect(scheduleSave).not.toHaveBeenCalled()
  })
})
