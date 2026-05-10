import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { tabStore } from '../../stores/tabStore'
import { useGraphEventHandlers, type GraphEventHandlerDeps } from './graphEventHandlers'
import type { GraphOperations } from './graphOperations'

vi.mock('../../core/log-backend', () => ({
  logAction: vi.fn(async () => true),
}))

type NodeOverrides = Omit<Partial<KnowledgeNode>, 'data'> & {
  data?: Partial<KnowledgeNode['data']>
}

function makeNode(id: string, overrides: NodeOverrides = {}): KnowledgeNode {
  const { data: dataOverrides, ...nodeOverrides } = overrides
  return {
    id,
    type: 'knowledgeCard',
    position: { x: 0, y: 0 },
    ...nodeOverrides,
    data: {
      label: id,
      path: id,
      hasChildren: false,
      nodeType: 'leaf',
      ...dataOverrides,
    },
  }
}

function makeEdge(id: string, selected = false): KnowledgeEdge {
  return {
    id,
    source: 'A',
    target: 'B',
    data: {
      relation: '相关',
      weight: 'minor',
      selected,
    },
  }
}

function createOps(): GraphOperations {
  return {
    createChildNode: vi.fn(),
    deleteChildNode: vi.fn(),
    renameNode: vi.fn(),
    addEdge: vi.fn(),
    deleteEdge: vi.fn(),
    updateEdgeRelation: vi.fn(),
    updateEdgeStyle: vi.fn(),
    applyNodePositionChanges: vi.fn(),
    applyNodeRemoveChanges: vi.fn(),
    applyNodeDimensionChanges: vi.fn(),
    selectNode: vi.fn(),
    deselectNode: vi.fn(),
    scheduleSave: vi.fn(),
    saveNow: vi.fn(async () => undefined),
  } as unknown as GraphOperations
}

function createDeps(overrides: Partial<GraphEventHandlerDeps> = {}) {
  const nodesRef = { current: [makeNode('A'), makeNode('B', { data: { connectTarget: true } })] }
  const edgesRef = { current: [makeEdge('e1', true), makeEdge('e2')] }
  const ops = createOps()
  const setSelectedEdgeId = vi.fn()
  const setRightPanelTab = vi.fn()
  const clearSelection = vi.fn()
  const rebuildMaps = vi.fn()
  const setState = vi.fn((updater) => {
    const next = updater({ nodes: nodesRef.current, edges: edgesRef.current })
    nodesRef.current = next.nodes
    edgesRef.current = next.edges
  }) as GraphEventHandlerDeps['setState']

  const deps: GraphEventHandlerDeps = {
    tabId: 'KB',
    ops,
    nodesRef,
    edgesRef,
    getActiveNavState: () => ({ kbPath: 'KB', roomPath: 'KB', roomName: 'KB' }),
    rebuildMaps,
    setState,
    clearSelection,
    defaultEdgeStyle: { lineMode: 'straight', lineStyle: 'dashed', color: '#123456', arrow: false },
    setSelectedEdgeId,
    setRightPanelTab,
    ...overrides,
  }

  return { deps, ops, nodesRef, edgesRef, setSelectedEdgeId, setRightPanelTab, clearSelection, rebuildMaps }
}

describe('useGraphEventHandlers', () => {
  beforeEach(() => {
    tabStore.getState().reset()
    tabStore.getState().addKBTab({ id: 'KB', label: 'KB', kbPath: 'KB' })
  })

  it('routes React Flow node changes to graph operations', () => {
    const { deps, ops } = createDeps()
    const { result } = renderHook(() => useGraphEventHandlers(deps))

    act(() => {
      result.current.onNodesChange([
        { type: 'position', id: 'A', position: { x: 1, y: 2 }, dragging: false },
        { type: 'dimensions', id: 'A', dimensions: { width: 10, height: 20 } },
        { type: 'remove', id: 'B' },
      ])
    })

    expect(ops.applyNodePositionChanges).toHaveBeenCalledWith([{ id: 'A', position: { x: 1, y: 2 } }])
    expect(ops.applyNodeDimensionChanges).toHaveBeenCalledWith([{ id: 'A', dimensions: { width: 10, height: 20 } }])
    expect(ops.applyNodeRemoveChanges).toHaveBeenCalledWith(['B'])
  })

  it('selects an edge and clears previous selected edges', () => {
    const { deps, ops, clearSelection, setSelectedEdgeId, setRightPanelTab } = createDeps()
    const { result } = renderHook(() => useGraphEventHandlers(deps))

    act(() => {
      result.current.onEdgeClick({} as React.MouseEvent, { id: 'e2' } as never)
    })

    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(ops.updateEdgeStyle).toHaveBeenCalledWith('e1', { selected: false })
    expect(ops.updateEdgeStyle).toHaveBeenCalledWith('e2', { selected: true })
    expect(setSelectedEdgeId).toHaveBeenCalledWith('e2')
    expect(setRightPanelTab).toHaveBeenCalledWith('style')
  })

  it('clears selected edge and connect-target highlights on pane click', () => {
    const { deps, ops, nodesRef, setSelectedEdgeId, rebuildMaps } = createDeps()
    const { result } = renderHook(() => useGraphEventHandlers(deps))

    act(() => {
      result.current.onPaneClick()
    })

    expect(ops.deselectNode).toHaveBeenCalledTimes(1)
    expect(ops.updateEdgeStyle).toHaveBeenCalledWith('e1', { selected: false })
    expect(nodesRef.current[1].data.connectTarget).toBe(false)
    expect(rebuildMaps).toHaveBeenCalled()
    expect(setSelectedEdgeId).toHaveBeenCalledWith(null)
  })

  it('saves current room and enters child room on container double click', async () => {
    const { deps, ops } = createDeps()
    const { result } = renderHook(() => useGraphEventHandlers(deps))

    await act(async () => {
      await result.current.onNodeDoubleClick({} as React.MouseEvent, makeNode('KB/Child', {
        data: {
          label: 'Child',
          path: 'KB/Child',
          hasChildren: true,
          nodeType: 'container',
        },
      }))
    })

    const tab = tabStore.getState().getTabById('KB')
    expect(ops.saveNow).toHaveBeenCalledWith('KB')
    expect(tab?.currentRoomPath).toBe('KB/Child')
    expect(tab?.currentRoomName).toBe('Child')
  })

  it('creates an edge with default style and selects it', () => {
    const { deps, ops, setSelectedEdgeId } = createDeps()
    const { result } = renderHook(() => useGraphEventHandlers(deps))

    act(() => {
      result.current.onConnect({ source: 'A', target: 'B', sourceHandle: null, targetHandle: null })
    })

    expect(ops.addEdge).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'A', target: 'B' }),
      expect.stringMatching(/^e-/),
      deps.defaultEdgeStyle
    )
    expect(setSelectedEdgeId).toHaveBeenCalledWith(expect.stringMatching(/^e-/))
  })
})
