import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeNode } from '../../types'
import { buildSelectionOperations } from './selectionOperations'

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

describe('selectionOperations', () => {
  it('selects a node and syncs selected node state', () => {
    const node = makeNode('A')
    const setActiveSelectedNodeId = vi.fn()
    const updateSelectedNode = vi.fn()
    const ops = buildSelectionOperations({
      nodesMapRef: { current: new Map([[node.id, node]]) },
      nodesRef: { current: [node] },
      setActiveSelectedNodeId,
      updateSelectedNode,
    })

    ops.selectNode('A')

    expect(setActiveSelectedNodeId).toHaveBeenCalledWith('A')
    expect(updateSelectedNode).toHaveBeenCalledWith([node], 'A')
  })

  it('deselects the active node', () => {
    const node = makeNode('A')
    const setActiveSelectedNodeId = vi.fn()
    const updateSelectedNode = vi.fn()
    const ops = buildSelectionOperations({
      nodesMapRef: { current: new Map([[node.id, node]]) },
      nodesRef: { current: [node] },
      setActiveSelectedNodeId,
      updateSelectedNode,
    })

    ops.deselectNode()

    expect(setActiveSelectedNodeId).toHaveBeenCalledWith(null)
    expect(updateSelectedNode).toHaveBeenCalledWith([node], null)
  })
})
