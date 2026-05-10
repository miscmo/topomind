import { describe, expect, it, vi } from 'vitest'
import { buildEdges, buildMetaFromNodesEdges, buildNodes } from './graphBuilder'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import type { GraphMeta } from '../../core/storage/types'

describe('graphBuilder', () => {
  it('serializes node position into graph metadata', () => {
    const nodes: KnowledgeNode[] = [
      {
        id: 'KB/Child',
        type: 'knowledgeCard',
        position: { x: 12, y: 34 },
        data: {
          label: 'Child',
          path: 'KB/Child',
          hasChildren: false,
          nodeType: 'leaf',
        },
      },
    ]
    const edges: KnowledgeEdge[] = []

    const meta = buildMetaFromNodesEdges(nodes, edges)

    expect(meta.nodes['KB/Child'].position).toEqual({ x: 12, y: 34 })
  })

  it('uses persisted node position before derived child viewport position', async () => {
    const meta: GraphMeta = {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'Child', name: 'Child' },
          width: 200,
          height: 150,
          position: { x: 7, y: 8 },
        },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }
    const storage = {
      countChildren: vi.fn().mockResolvedValue(0),
    }

    const nodes = await buildNodes(storage as never, 'KB', meta, { 'KB/Child': { x: 100, y: 200 } }, 'KB')

    expect(nodes[0].position).toEqual({ x: 7, y: 8 })
  })

  it('uses saved child-room position when graph node has no persisted position', async () => {
    const meta: GraphMeta = {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'Child', name: 'Child' },
          width: 200,
          height: 150,
        },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }
    const storage = {
      countChildren: vi.fn().mockResolvedValue(0),
    }

    const nodes = await buildNodes(storage as never, 'KB', meta, { 'KB/Child': { x: 100, y: 200 } }, 'KB')

    expect(nodes[0]).toMatchObject({
      id: 'KB/Child',
      position: { x: 100, y: 200 },
      data: { path: 'KB/Child' },
    })
    expect(storage.countChildren).toHaveBeenCalledWith('KB/Child')
  })

  it('does not double-prefix full card refs when building nodes and edges', async () => {
    const meta: GraphMeta = {
      nodes: {
        Child: {
          id: 'KB/Child',
          card: { ref: 'KB/Child', name: 'Child' },
          width: 200,
          height: 150,
        },
        Other: {
          id: 'Other',
          card: { ref: 'Other', name: 'Other' },
          width: 200,
          height: 150,
        },
      },
      edges: [
        {
          id: 'e1',
          source: { ref: 'Child', name: '' },
          target: { ref: 'KB/Other', name: '' },
          relation: '相关',
          weight: 'minor',
        },
      ],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }
    const storage = {
      countChildren: vi.fn().mockResolvedValue(0),
    }

    const nodes = await buildNodes(storage as never, 'KB', meta, {}, 'KB')
    const edges = buildEdges(meta, 'KB')

    expect(nodes.map((node) => node.id)).toEqual(['KB/Child', 'KB/Other'])
    expect(edges[0]).toMatchObject({ source: 'KB/Child', target: 'KB/Other' })
  })
})
