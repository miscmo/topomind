import { describe, expect, it } from 'vitest'
import type { GraphMeta } from '../../core/storage/adapter/graph'
import { graphMetaToRoomGraph, roomGraphToGraphMeta } from './graphMapper'

describe('graphMapper', () => {
  it('converts GraphMeta to canonical RoomGraph and preserves position', () => {
    const meta: GraphMeta = {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'KB/Child', name: 'Child Name' },
          width: 210,
          height: 160,
          position: { x: 42, y: 99 },
        },
      },
      edges: [
        {
          id: 'e1',
          source: { ref: 'KB/Child', name: '' },
          target: { ref: 'KB/Other', name: '' },
          relation: '相关',
          weight: 'minor',
          color: '#123456',
        },
      ],
      viewport: { zoom: 1.5, pan: { x: 10, y: 20 } },
    }

    const graph = graphMetaToRoomGraph('KB', meta)

    expect(graph.roomRef).toBe('KB')
    expect(graph.nodes['KB/Child']).toMatchObject({
      id: 'KB/Child',
      cardRef: 'KB/Child',
      name: 'Child Name',
      position: { x: 42, y: 99 },
      size: { width: 210, height: 160 },
    })
    expect(graph.edges[0]).toMatchObject({
      id: 'e1',
      sourceRef: 'KB/Child',
      targetRef: 'KB/Other',
      color: '#123456',
    })
  })

  it('keeps missing node position undefined so callers can apply their own fallback', () => {
    const graph = graphMetaToRoomGraph('KB', {
      nodes: {
        Child: {
          id: 'Child',
          card: { ref: 'Child', name: 'Child Name' },
          width: 200,
          height: 150,
        },
      },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    })

    expect(graph.nodes['KB/Child'].position).toBeUndefined()
  })

  it('converts canonical RoomGraph back to GraphMeta', () => {
    const meta = roomGraphToGraphMeta({
      roomRef: 'KB',
      nodes: {
        'KB/Child': {
          id: 'KB/Child',
          cardRef: 'KB/Child',
          name: 'Child Name',
          position: { x: 1, y: 2 },
          size: { width: 220, height: 170 },
        },
      },
      edges: [
        {
          id: 'e1',
          sourceRef: 'KB/Child',
          targetRef: 'KB/Other',
          relation: '依赖',
          weight: 'main',
        },
      ],
      viewport: { zoom: 2, pan: { x: 3, y: 4 } },
    })

    expect(meta.nodes['KB/Child']).toMatchObject({
      id: 'KB/Child',
      card: { ref: 'KB/Child', name: 'Child Name' },
      position: { x: 1, y: 2 },
      width: 220,
      height: 170,
    })
    expect(meta.edges[0]).toMatchObject({
      id: 'e1',
      source: { ref: 'KB/Child' },
      target: { ref: 'KB/Other' },
      relation: '依赖',
      weight: 'main',
    })
  })
})
