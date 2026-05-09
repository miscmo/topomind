import { describe, expect, it, vi } from 'vitest'
import type { GraphMeta } from '../../core/storage/adapter/graph'
import type { KnowledgeNode } from '../../types'
import { createChildCard, deleteCardAndPruneGraph, type CardServiceStorage } from './cardService'

function emptyLayout(): GraphMeta {
  return {
    nodes: {},
    edges: [],
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  }
}

describe('cardService', () => {
  it('creates a child card and updates parent/current room layouts with the returned ref', async () => {
    const layouts = new Map<string, GraphMeta>([
      ['KB/Parent', emptyLayout()],
      ['KB', {
        ...emptyLayout(),
        nodes: {
          Parent: {
            id: 'Parent',
            card: { ref: 'KB/Parent', name: 'Parent' },
            width: 200,
            height: 150,
          },
        },
      }],
    ])
    const storage: CardServiceStorage = {
      createCard: vi.fn().mockResolvedValue('KB/Parent/Child-1'),
      deleteCard: vi.fn(),
      renameCard: vi.fn(),
      readLayout: vi.fn(async (roomRef) => layouts.get(roomRef) ?? emptyLayout()),
      writeLayout: vi.fn(async (roomRef, meta) => { layouts.set(roomRef, meta) }),
    }
    const nodesById = new Map<string, KnowledgeNode>([
      ['KB/Parent', {
        id: 'KB/Parent',
        type: 'knowledgeCard',
        position: { x: 0, y: 0 },
        data: {
          label: 'Parent',
          path: 'KB/Parent',
          hasChildren: false,
          nodeType: 'leaf',
        },
      }],
    ])

    const result = await createChildCard(storage, {
      name: 'Child',
      parentRef: 'KB/Parent',
      reloadRef: 'KB',
      nodesById,
    })

    expect(result.newRef).toBe('KB/Parent/Child-1')
    expect(layouts.get('KB/Parent')?.nodes['Child-1']).toMatchObject({
      id: 'Child-1',
      card: { ref: 'KB/Parent/Child-1', name: 'Child' },
    })
    expect(layouts.get('KB')?.nodes['Child-1']).toMatchObject({
      id: 'Child-1',
      card: { ref: 'KB/Parent/Child-1', name: 'Child' },
    })
  })

  it('deletes a card and prunes connected edges from lookup maps', async () => {
    const storage: CardServiceStorage = {
      createCard: vi.fn(),
      deleteCard: vi.fn(),
      renameCard: vi.fn(),
      readLayout: vi.fn(),
      writeLayout: vi.fn(),
    }
    const nodesById = new Map<string, KnowledgeNode>([
      ['A', {
        id: 'A',
        type: 'knowledgeCard',
        position: { x: 0, y: 0 },
        data: { label: 'A', path: 'A', hasChildren: false, nodeType: 'leaf' },
      }],
    ])
    const edgesById = new Map([
      ['e1', { id: 'e1', source: 'A', target: 'B', data: { relation: '相关', weight: 'minor' } }],
      ['e2', { id: 'e2', source: 'B', target: 'C', data: { relation: '相关', weight: 'minor' } }],
    ])

    await deleteCardAndPruneGraph(storage, 'A', nodesById, edgesById as never)

    expect(storage.deleteCard).toHaveBeenCalledWith('A')
    expect(nodesById.has('A')).toBe(false)
    expect(edgesById.has('e1')).toBe(false)
    expect(edgesById.has('e2')).toBe(true)
  })

  it('does not write layout when card creation returns no ref', async () => {
    const storage: CardServiceStorage = {
      createCard: vi.fn().mockResolvedValue(null),
      deleteCard: vi.fn(),
      renameCard: vi.fn(),
      readLayout: vi.fn(async () => emptyLayout()),
      writeLayout: vi.fn(),
    }

    await expect(createChildCard(storage, {
      name: 'Child',
      parentRef: 'KB/Parent',
      reloadRef: 'KB',
      nodesById: new Map(),
    })).rejects.toThrow('创建卡片失败')

    expect(storage.writeLayout).not.toHaveBeenCalled()
  })
})
