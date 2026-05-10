import { describe, expect, it, vi } from 'vitest'
import type { GraphMeta } from '../../core/storage/types'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { buildGraphOperations, type GraphOpsDeps, type StorageApi } from './graphOperations'

vi.mock('../../core/log-backend', () => ({
  logAction: vi.fn(async () => true),
}))

vi.mock('../../core/logger', () => ({
  logger: {
    catch: vi.fn(),
  },
}))

function makeMeta(): GraphMeta {
  return {
    nodes: {},
    edges: [],
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  }
}

function makeNode(id: string, label = id): KnowledgeNode {
  return {
    id,
    type: 'knowledgeCard',
    position: { x: 0, y: 0 },
    data: {
      label,
      path: id,
      hasChildren: false,
      nodeType: 'leaf',
    },
  }
}

function createDeps(overrides: Partial<GraphOpsDeps> = {}) {
  const node = makeNode('A')
  const edge: KnowledgeEdge = {
    id: 'e1',
    source: 'A',
    target: 'B',
    data: { relation: '相关', weight: 'minor' },
  }
  const nodesRef = { current: [node] }
  const edgesRef = { current: [edge] }
  const nodesMapRef = { current: new Map([[node.id, node]]) }
  const edgesMapRef = { current: new Map([[edge.id, edge]]) }
  const setDirtyState = vi.fn()
  const storage: StorageApi = {
    createCard: vi.fn(async () => 'A/Child'),
    deleteCard: vi.fn(async () => undefined),
    renameCard: vi.fn(async () => undefined),
    saveGraphDebounced: vi.fn(async (_dirPath, _buildMeta, onFlush) => {
      onFlush()
    }),
    flushGraphSave: vi.fn(async (_dirPath, _buildMeta, onFlush) => {
      onFlush()
    }),
    readLayout: vi.fn(async () => makeMeta()),
    writeLayout: vi.fn(async () => undefined),
  }
  const deps: GraphOpsDeps = {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB', roomName: 'KB' }),
    loadRoom: vi.fn(async () => undefined),
    rebuildMaps: vi.fn((nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
      nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
      edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
    }),
    setState: vi.fn((updater) => {
      const next = updater({ nodes: nodesRef.current, edges: edgesRef.current })
      nodesRef.current = next.nodes
      edgesRef.current = next.edges
    }) as GraphOpsDeps['setState'],
    getActiveSelectedNodeId: () => null,
    setActiveSelectedNodeId: vi.fn(),
    updateSelectedNode: vi.fn(),
    setDirtyState,
    isCreatingRef: { current: false },
    isModifiedRef: { current: false },
    ...overrides,
  }

  return { deps, storage, setDirtyState }
}

describe('graphOperations dirty handling', () => {
  it('marks dirty before a debounced save and clears it after save callback', () => {
    const { deps, storage, setDirtyState } = createDeps()
    const ops = buildGraphOperations(deps)

    ops.updateEdgeRelation('e1', '依赖', 'main')

    expect(storage.saveGraphDebounced).toHaveBeenCalledTimes(1)
    expect(setDirtyState).toHaveBeenNthCalledWith(1, true)
    expect(setDirtyState).toHaveBeenLastCalledWith(false)
  })

  it('marks dirty before an immediate flush save and clears it after save callback', async () => {
    const { deps, storage, setDirtyState } = createDeps()
    const ops = buildGraphOperations(deps)

    await ops.deleteChildNode('A')

    expect(storage.flushGraphSave).toHaveBeenCalledTimes(1)
    expect(setDirtyState).toHaveBeenNthCalledWith(1, true)
    expect(setDirtyState).toHaveBeenLastCalledWith(false)
  })
})
