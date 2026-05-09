import { describe, expect, it } from 'vitest'
import type { GraphMeta } from '../adapter/graph'
import { convertFSBToGraph, convertGraphToFSB } from './file'

describe('file storage graph conversion', () => {
  it('converts KB-relative FSB graph metadata to canonical GraphMeta', () => {
    const meta = convertFSBToGraph({
      children: {
        Child: { name: 'Child Name', x: 12, y: 34 },
        Full: { name: 'Full Name', path: 'Full', x: 56, y: 78 },
      },
      edges: [
        {
          id: 'e1',
          source: 'Child',
          target: 'Full',
          relation: '依赖',
          weight: 'main',
          lineMode: 'straight',
          lineStyle: 'dashed',
          color: '#123456',
          arrow: false,
          highlighted: true,
          faded: false,
        },
      ],
      zoom: 1.5,
      pan: { x: 5, y: 6 },
    }, 'KB')

    expect(meta.nodes['KB/Child']).toMatchObject({
      id: 'KB/Child',
      card: { ref: 'KB/Child', name: 'Child Name' },
      position: { x: 12, y: 34 },
    })
    expect(meta.nodes['KB/Full']).toMatchObject({
      id: 'KB/Full',
      card: { ref: 'KB/Full', name: 'Full Name' },
      position: { x: 56, y: 78 },
    })
    expect(meta.edges[0]).toMatchObject({
      id: 'e1',
      source: { ref: 'KB/Child' },
      target: { ref: 'KB/Full' },
      relation: '依赖',
      weight: 'main',
      lineMode: 'straight',
      lineStyle: 'dashed',
      color: '#123456',
      arrow: false,
      highlighted: true,
      faded: false,
    })
    expect(meta.viewport).toEqual({ zoom: 1.5, pan: { x: 5, y: 6 } })
  })

  it('converts canonical GraphMeta back to FSB room-relative children and edges', () => {
    const meta: GraphMeta = {
      nodes: {
        'KB/Child': {
          id: 'KB/Child',
          card: { ref: 'KB/Child', name: 'Child Name' },
          width: 200,
          height: 150,
          position: { x: 12, y: 34 },
        },
        External: {
          id: 'External',
          card: { ref: 'Other/External', name: 'External Name' },
          width: 200,
          height: 150,
        },
      },
      edges: [
        {
          id: 'e1',
          source: { ref: 'KB/Child', name: '' },
          target: { ref: 'Other/External', name: '' },
          relation: '相关',
          weight: 'minor',
          color: '#abcdef',
          arrow: true,
        },
      ],
      viewport: { zoom: 2, pan: { x: 7, y: 8 } },
    }

    const fsb = convertGraphToFSB(meta, 'KB')

    expect(fsb.children?.Child).toEqual({
      path: 'Child',
      name: 'Child Name',
      hasChildren: false,
      x: 12,
      y: 34,
    })
    expect(fsb.children?.['Other/External']).toMatchObject({
      path: 'Other/External',
      name: 'External Name',
      hasChildren: false,
    })
    expect(fsb.edges?.[0]).toMatchObject({
      id: 'e1',
      source: 'Child',
      target: 'Other/External',
      relation: '相关',
      weight: 'minor',
      color: '#abcdef',
      arrow: true,
    })
    expect(fsb.zoom).toBe(2)
    expect(fsb.pan).toEqual({ x: 7, y: 8 })
  })
})
