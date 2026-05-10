import { describe, expect, it, vi } from 'vitest'
import type { GraphMeta } from '../../core/storage/adapter/graph'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import type { StorageApi } from './graphOperations'
import { buildNodeCrudOperations, type NodeCrudOperationsDeps } from './nodeCrudOperations'

vi.mock('../../core/log-backend', () => ({
  logAction: vi.fn(async () => true),
}))

vi.mock('../../core/logger', () => ({
  logger: {
    catch: vi.fn(),
  },
}))

function emptyLayout(): GraphMeta {
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
    data: { label, path: id, hasChildren: false, nodeType: 'leaf' },
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

function createDeps(overrides: Partial<NodeCrudOperationsDeps> = {}) {
  const node = makeNode('A', 'Alpha')
  const edge = makeEdge('e1', 'A', 'B')
  const nodesRef = { current: [node] }
  const nodesMapRef = { current: new Map([[node.id, node]]) }
  const edgesMapRef = { current: new Map([[edge.id, edge]]) }
  const layouts = new Map<string, GraphMeta>([
    ['KB', {
      ...emptyLayout(),
      nodes: {
        A: { id: 'A', card: { ref: 'A', name: 'Alpha' }, width: 200, height: 150 },
      },
    }],
    ['KB/Parent', emptyLayout()],
  ])
  const storage: StorageApi = {
    createCard: vi.fn(async () => 'KB/Parent/Child'),
    deleteCard: vi.fn(async () => undefined),
    renameCard: vi.fn(async () => undefined),
    saveGraphDebounced: vi.fn(async (_dirPath, _buildMeta, onFlush) => onFlush()),
    flushGraphSave: vi.fn(async (_dirPath, _buildMeta, onFlush) => onFlush()),
    readLayout: vi.fn(async (dirPath) => layouts.get(dirPath) ?? emptyLayout()),
    writeLayout: vi.fn(async (dirPath, meta) => { layouts.set(dirPath, meta) }),
  }
  const setState = vi.fn((updater) => {
    const next = updater({ nodes: nodesRef.current, edges: [edge] })
    nodesRef.current = next.nodes
  }) as NodeCrudOperationsDeps['setState']
  const deps: NodeCrudOperationsDeps = {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB', roomName: 'KB' }),
    loadRoom: vi.fn(async () => undefined),
    rebuildMaps: vi.fn(),
    saveNow: vi.fn(async () => undefined),
    scheduleSave: vi.fn(),
    setState,
    getActiveSelectedNodeId: () => null,
    setActiveSelectedNodeId: vi.fn(),
    setDirtyState: vi.fn(),
    isCreatingRef: { current: false },
    ...overrides,
  }

  return { deps, storage, nodesRef, nodesMapRef, edgesMapRef, layouts }
}

describe('nodeCrudOperations', () => {
  it('creates a child card, reloads the room, and schedules save', async () => {
    const { deps, storage } = createDeps({
      getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB/Parent', roomName: 'Parent' }),
    })
    const ops = buildNodeCrudOperations(deps)

    const result = await ops.createChildNode('Child', undefined, { x: 10, y: 20 })

    expect(result).toBe('KB/Parent/Child')
    expect(storage.createCard).toHaveBeenCalledWith('KB/Parent', 'Child')
    expect(deps.setDirtyState).toHaveBeenCalledWith(true)
    expect(deps.loadRoom).toHaveBeenCalledWith('KB/Parent', true)
    expect(deps.scheduleSave).toHaveBeenCalledWith('KB/Parent')
    expect(deps.isCreatingRef.current).toBe(true)
  })

  it('returns null without writing when there is no target path', async () => {
    const { deps, storage } = createDeps({
      getActiveNavState: () => ({ kbPath: '', roomPath: '', roomName: '' }),
    })
    const ops = buildNodeCrudOperations(deps)

    const result = await ops.createChildNode('Child')

    expect(result).toBeNull()
    expect(storage.createCard).not.toHaveBeenCalled()
    expect(deps.setDirtyState).not.toHaveBeenCalled()
  })

  it('deletes a node, flushes current room, reloads, and clears selection', async () => {
    const { deps, storage, nodesMapRef, edgesMapRef } = createDeps({
      getActiveSelectedNodeId: () => 'A',
    })
    const ops = buildNodeCrudOperations(deps)

    const result = await ops.deleteChildNode('A')

    expect(result).toBe(true)
    expect(storage.deleteCard).toHaveBeenCalledWith('A')
    expect(nodesMapRef.current.has('A')).toBe(false)
    expect(edgesMapRef.current.has('e1')).toBe(false)
    expect(deps.saveNow).toHaveBeenCalledWith('KB')
    expect(deps.loadRoom).toHaveBeenCalledWith('KB')
    expect(deps.setActiveSelectedNodeId).toHaveBeenCalledWith(null)
  })

  it('renames local node label and schedules save', async () => {
    const { deps, storage, nodesRef } = createDeps()
    const ops = buildNodeCrudOperations(deps)

    const result = await ops.renameNode('A', 'Renamed')

    expect(result).toBe(true)
    expect(storage.renameCard).toHaveBeenCalledWith('A', 'Renamed')
    expect(nodesRef.current[0].data.label).toBe('Renamed')
    expect(deps.rebuildMaps).toHaveBeenCalled()
    expect(deps.scheduleSave).toHaveBeenCalledWith('KB')
  })
})
