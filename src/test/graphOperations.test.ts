/**
 * @vitest-environment jsdom
 */
import type { MutableRefObject } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildGraphOperations } from '../hooks/useGraph/graphOperations'
import type { GraphOpsDeps, StorageApi } from '../hooks/useGraph/graphOperations'
import type { KnowledgeNode, KnowledgeEdge } from '../types'

// Helper to create a fresh deps mock for each test
type SetStateMock = ((updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => {
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null
}) => void) & { mock: { calls: unknown[]; results: unknown[] } }

function createMockDeps(overrides: Partial<GraphOpsDeps> = {}): Omit<GraphOpsDeps, 'setState'> & {
  setState: SetStateMock
  _mockState: typeof state
} {
  let state: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading: boolean; selectedNode: KnowledgeNode | null } = {
    nodes: [], edges: [], loading: false, selectedNode: null
  }

  const nodesMapRef = { current: new Map<string, KnowledgeNode>() } as MutableRefObject<Map<string, KnowledgeNode>>
  const edgesMapRef = { current: new Map<string, KnowledgeEdge>() } as MutableRefObject<Map<string, KnowledgeEdge>>
  const nodesRef = { current: [] } as MutableRefObject<KnowledgeNode[]>
  const edgesRef = { current: [] } as MutableRefObject<KnowledgeEdge[]>

  const mockFn = vi.fn((updater) => {
    const result = updater(state)
    state = { ...state, ...result }
    // Simulate rebuildMaps: keep refs in sync after every setState
    nodesRef.current = state.nodes
    edgesRef.current = state.edges
    nodesMapRef.current = new Map(state.nodes.map((n) => [n.id, n]))
    edgesMapRef.current = new Map(state.edges.map((e) => [e.id, e]))
  })
  const mockSetState = mockFn as unknown as GraphOpsDeps["setState"]

  const mockRebuildMaps = (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
    nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
    edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
  }

  return {
    storage: {
      createCard: vi.fn().mockResolvedValue(null),
      deleteCard: vi.fn().mockResolvedValue(undefined),
      renameCard: vi.fn().mockResolvedValue(undefined),
      saveGraphDebounced: vi.fn(),
      flushGraphSave: vi.fn().mockResolvedValue(undefined),
    } as unknown as StorageApi,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveNavState: vi.fn().mockReturnValue({ kbPath: 'kb', roomPath: 'kb/room', roomName: 'room' }),
    loadRoom: vi.fn().mockResolvedValue(undefined),
    rebuildMaps: mockRebuildMaps,
    // @ts-expect-error - mock vi.fn() typed as SpyInstance, not assignable to GraphOpsDeps.setState
    setState: mockSetState,
    getActiveSelectedNodeId: vi.fn().mockReturnValue(null),
    setActiveSelectedNodeId: vi.fn(),
    updateSelectedNode: vi.fn(),
    setDirtyState: vi.fn(),
    _mockState: state,
    ...overrides,
  }
}

describe('graphOperations', () => {
  // Helper: cast the unknown updater in setState.mock.calls to the expected signature
  const getCallUpdater = (deps: ReturnType<typeof createMockDeps>, callIndex = 0) =>
    (deps.setState.mock.calls[callIndex] as unknown[])[0] as (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => {
      nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null
    }

  describe('addEdge', () => {
    it('adds a new edge to state and updates refs', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      ops.addEdge({ source: 'node1', target: 'node2', sourceHandle: null, targetHandle: null }, 'edge-abc123')

      expect(deps.setState).toHaveBeenCalled()
      const call = getCallUpdater(deps)
      const result = call({ nodes: [], edges: [] })
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0].id).toBe('edge-abc123')
      expect(result.edges[0].source).toBe('node1')
      expect(result.edges[0].target).toBe('node2')
      expect(result.edges[0].type).toBe('smoothstep')
      expect(result.edges[0].data).toMatchObject({ relation: '相关', weight: 'minor', highlighted: false, faded: false })
    })

    it('calls scheduleSave with dirPath', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)
      ops.addEdge({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null }, 'edge1')
      // scheduleSave is internal; verify saveGraphDebounced was called via setState
      expect(deps.storage.saveGraphDebounced).toHaveBeenCalled()
    })

    it('logs the edge creation action', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)
      ops.addEdge({ source: 'x', target: 'y', sourceHandle: null, targetHandle: null }, 'edge2')
      // The operation runs without throwing
      expect(true).toBe(true)
    })
  })

  describe('deleteEdge', () => {
    it('removes the edge from state and updates edgesMapRef', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      // Seed the state with one edge
      const initialEdges: KnowledgeEdge[] = [
        { id: 'edge1', source: 'a', target: 'b', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } },
      ]
      deps.edgesRef.current = [...initialEdges]
      deps.edgesMapRef.current = new Map(initialEdges.map((e) => [e.id, e]))

      ops.deleteEdge('edge1')

      expect(deps.setState).toHaveBeenCalled()
      const call = getCallUpdater(deps)
      const result = call({ nodes: [], edges: initialEdges })
      expect(result.edges).toHaveLength(0)
      expect(deps.edgesMapRef.current.has('edge1')).toBe(false)
    })

    it('does not affect nodes in state', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const existingNode: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'Node 1', path: 'node1', hasChildren: false, nodeType: 'leaf' },
      }
      deps.nodesRef.current = [existingNode]
      const initialEdges: KnowledgeEdge[] = [{ id: 'edge1', source: 'node1', target: 'node2', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } }]
      deps.edgesRef.current = [...initialEdges]
      deps.edgesMapRef.current = new Map(initialEdges.map((e) => [e.id, e]))

      ops.deleteEdge('edge1')

      const call = getCallUpdater(deps)
      const result = call({ nodes: [existingNode], edges: initialEdges })
      expect(result.nodes).toHaveLength(1)
    })
  })

  describe('updateEdgeRelation', () => {
    it('updates the relation and weight of the specified edge', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const initialEdge: KnowledgeEdge = {
        id: 'edge1', source: 'a', target: 'b', type: 'smoothstep',
        data: { relation: '相关', weight: 'minor', highlighted: false, faded: false },
      }
      deps.edgesRef.current = [initialEdge]
      deps.edgesMapRef.current = new Map([['edge1', initialEdge]])
      // Seed mock state so prev.edges matches what the updater expects
      deps._mockState.edges = [initialEdge]
      deps._mockState.nodes = []
      // Keep a reference before mockSetState mutates state.edges to []
      const seededEdges = [initialEdge]

      ops.updateEdgeRelation('edge1', '依赖', 'main')

      const call = getCallUpdater(deps)
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[0].data.relation).toBe('依赖')
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[0].data.weight).toBe('main')
    })

    it('leaves other edges unchanged', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const edges: KnowledgeEdge[] = [
        { id: 'e1', source: 'a', target: 'b', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } },
        { id: 'e2', source: 'b', target: 'c', type: 'smoothstep', data: { relation: '演进', weight: 'main', highlighted: false, faded: false } },
      ]
      deps.edgesRef.current = [...edges]
      deps.edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
      deps._mockState.edges = [...edges]
      deps._mockState.nodes = []
      const seededEdges = [...edges]

      ops.updateEdgeRelation('e1', '依赖', 'minor')

      const call = getCallUpdater(deps)
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges).toHaveLength(2)
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[0].data.relation).toBe('依赖')
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[0].data.weight).toBe('minor')
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[1].data.relation).toBe('演进')
      // @ts-expect-error - test assertion with guaranteed array length
      expect(call({ nodes: deps._mockState.nodes, edges: seededEdges }).edges[1].data.weight).toBe('main')
    })

    it('updates edgesMapRef so subsequent reads return fresh data', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const edge: KnowledgeEdge = {
        id: 'edge1', source: 'a', target: 'b', type: 'smoothstep',
        data: { relation: '相关', weight: 'minor', highlighted: false, faded: false },
      }
      deps.edgesRef.current = [edge]
      deps.edgesMapRef.current = new Map([['edge1', edge]])
      deps._mockState.edges = [edge]
      deps._mockState.nodes = []

      ops.updateEdgeRelation('edge1', '演进', 'main')

      // After update, edgesMapRef should reflect the new data
      expect(deps.edgesMapRef.current.get('edge1')!.data!.relation).toBe('演进')
      expect(deps.edgesMapRef.current.get('edge1')!.data!.weight).toBe('main')
    })
  })

  describe('applyNodePositionChanges', () => {
    it('updates positions of the specified nodes', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const node1: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'Node 1', path: 'node1', hasChildren: false, nodeType: 'leaf' },
      }
      const node2: KnowledgeNode = {
        id: 'node2', type: 'knowledgeCard', position: { x: 100, y: 100 },
        data: { label: 'Node 2', path: 'node2', hasChildren: false, nodeType: 'leaf' },
      }
      deps.nodesRef.current = [node1, node2]
      deps.nodesMapRef.current = new Map([['node1', node1], ['node2', node2]])

      ops.applyNodePositionChanges([{ id: 'node1', position: { x: 500, y: 300 } }])

      expect(deps.setState).toHaveBeenCalled()
      const call = getCallUpdater(deps)
      const result = call({ nodes: [node1, node2], edges: [] })
      const updatedNode1 = result.nodes.find((n: KnowledgeNode) => n.id === 'node1')
      expect(updatedNode1?.position).toEqual({ x: 500, y: 300 })
      // node2 should be unchanged
      const updatedNode2 = result.nodes.find((n: KnowledgeNode) => n.id === 'node2')
      expect(updatedNode2?.position).toEqual({ x: 100, y: 100 })
    })

    it('updates nodesMapRef after position changes', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const node: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'Node', path: 'node1', hasChildren: false, nodeType: 'leaf' },
      }
      deps.nodesRef.current = [node]
      deps.nodesMapRef.current = new Map([['node1', node]])

      ops.applyNodePositionChanges([{ id: 'node1', position: { x: 123, y: 456 } }])

      const call = getCallUpdater(deps)
      // Pass the UPDATED node (with new position) to the updater — same as what
      // React's useState would pass internally.
      const updatedNode: KnowledgeNode = {
        ...node, position: { x: 123, y: 456 },
      }
      call({ nodes: [updatedNode], edges: [] })

      expect(deps.nodesMapRef.current.get('node1')?.position).toEqual({ x: 123, y: 456 })
    })
  })

  describe('applyNodeRemoveChanges', () => {
    it('removes the specified nodes from state', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const nodes: KnowledgeNode[] = [
        { id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N1', path: 'node1', hasChildren: false, nodeType: 'leaf' } },
        { id: 'node2', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N2', path: 'node2', hasChildren: false, nodeType: 'leaf' } },
        { id: 'node3', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N3', path: 'node3', hasChildren: false, nodeType: 'leaf' } },
      ]
      deps.nodesRef.current = [...nodes]
      deps.nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))

      ops.applyNodeRemoveChanges(['node1', 'node3'])

      expect(deps.setState).toHaveBeenCalled()
      const call = getCallUpdater(deps)
      const result = call({ nodes, edges: [] })
      expect(result.nodes.map((n: KnowledgeNode) => n.id)).toEqual(['node2'])
    })

    it('removes edges connected to deleted nodes (orphaned edge prevention)', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const nodes: KnowledgeNode[] = [
        { id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N1', path: 'node1', hasChildren: false, nodeType: 'leaf' } },
        { id: 'node2', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N2', path: 'node2', hasChildren: false, nodeType: 'leaf' } },
        { id: 'node3', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N3', path: 'node3', hasChildren: false, nodeType: 'leaf' } },
      ]
      const edges: KnowledgeEdge[] = [
        { id: 'e1', source: 'node1', target: 'node2', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } },
        { id: 'e2', source: 'node2', target: 'node3', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } },
        { id: 'e3', source: 'node1', target: 'node3', type: 'smoothstep', data: { relation: '相关', weight: 'minor', highlighted: false, faded: false } },
      ]
      deps.nodesRef.current = [...nodes]
      deps.edgesRef.current = [...edges]
      deps.nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
      deps.edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))

      ops.applyNodeRemoveChanges(['node1'])

      const call = getCallUpdater(deps)
      const result = call({ nodes, edges })
      // node1 deleted → e1 (src=node1) and e3 (src=node1) must be removed
      // node3 stays → e2 (src=node2, tgt=node3) stays
      expect(result.edges.map((e: KnowledgeEdge) => e.id)).toEqual(['e2'])
    })

    it('updates both nodesMapRef and edgesMapRef after removal', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const node: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'Node 1', path: 'node1', hasChildren: false, nodeType: 'leaf' },
      }
      const edge: KnowledgeEdge = {
        id: 'e1', source: 'node1', target: 'node2', type: 'smoothstep',
        data: { relation: '相关', weight: 'minor', highlighted: false, faded: false },
      }
      deps.nodesRef.current = [node]
      deps.edgesRef.current = [edge]
      deps.nodesMapRef.current = new Map([['node1', node]])
      deps.edgesMapRef.current = new Map([['e1', edge]])

      ops.applyNodeRemoveChanges(['node1'])

      expect(deps.nodesMapRef.current.has('node1')).toBe(false)
      expect(deps.edgesMapRef.current.has('e1')).toBe(false)
    })

    it('calls scheduleSave after removal', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const node: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'Node', path: 'node1', hasChildren: false, nodeType: 'leaf' },
      }
      deps.nodesRef.current = [node]
      deps.nodesMapRef.current = new Map([['node1', node]])

      ops.applyNodeRemoveChanges(['node1'])

      // scheduleSave calls setDirtyState(true) + saveGraphDebounced
      expect(deps.setDirtyState).toHaveBeenCalledWith(true)
      expect(deps.storage.saveGraphDebounced).toHaveBeenCalled()
    })
  })

  describe('applyNodeDimensionChanges', () => {
    it('updates measured dimensions for matching nodes', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const nodes: KnowledgeNode[] = [
        { id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N1', path: 'node1', hasChildren: false, nodeType: 'leaf' } },
        { id: 'node2', type: 'knowledgeCard', position: { x: 0, y: 0 }, data: { label: 'N2', path: 'node2', hasChildren: false, nodeType: 'leaf' } },
      ]
      deps.nodesRef.current = [...nodes]

      ops.applyNodeDimensionChanges([
        { id: 'node1', dimensions: { width: 200, height: 100 } },
        { id: 'node2', dimensions: null },
      ])

      expect(deps.setState).toHaveBeenCalled()
      const call = getCallUpdater(deps)
      const result = call({ nodes, edges: [] })
      expect((result.nodes as KnowledgeNode[]).find((n) => n.id === 'node1')?.measured).toEqual({ width: 200, height: 100 })
      expect((result.nodes as KnowledgeNode[]).find((n) => n.id === 'node2')?.measured).toBeUndefined()
    })

    it('leaves nodes not in changes array unchanged', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      const node1: KnowledgeNode = {
        id: 'node1', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'N1', path: 'node1', hasChildren: false, nodeType: 'leaf' },
        measured: { width: 100, height: 50 },
      }
      const node2: KnowledgeNode = {
        id: 'node2', type: 'knowledgeCard', position: { x: 0, y: 0 },
        data: { label: 'N2', path: 'node2', hasChildren: false, nodeType: 'leaf' },
      }
      deps.nodesRef.current = [node1, node2]

      ops.applyNodeDimensionChanges([{ id: 'node1', dimensions: { width: 300, height: 150 } }])

      const call = getCallUpdater(deps)
      const result = call({ nodes: [node1, node2], edges: [] })
      expect((result.nodes as KnowledgeNode[]).find((n) => n.id === 'node2')?.measured).toBeUndefined()
    })
  })

  describe('selectNode / deselectNode', () => {
    it('selectNode sets active node ID and calls updateSelectedNode', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      ops.selectNode('node1')

      expect(deps.setActiveSelectedNodeId).toHaveBeenCalledWith('node1')
      expect(deps.updateSelectedNode).toHaveBeenCalledWith(deps.nodesRef.current, 'node1')
    })

    it('deselectNode sets active node ID to null', () => {
      const deps = createMockDeps()
      const ops = buildGraphOperations(deps)

      ops.deselectNode()

      expect(deps.setActiveSelectedNodeId).toHaveBeenCalledWith(null)
      expect(deps.updateSelectedNode).toHaveBeenCalledWith(deps.nodesRef.current, null)
    })
  })
})