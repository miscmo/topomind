import { describe, expect, it } from 'vitest'
import type { GraphMeta } from './types'
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

  it('strips the current room ref from children with filesystem-like refs', () => {
    const roomRef = '../../../Code/topomind_cc/测试1'
    const childRef = `${roomRef}/32`
    const meta: GraphMeta = {
      nodes: {
        [childRef]: {
          id: childRef,
          card: { ref: childRef, name: '32' },
          width: 200,
          height: 150,
          position: { x: 179, y: 464 },
        },
      },
      edges: [
        {
          id: 'e1',
          source: { ref: childRef, name: '' },
          target: { ref: childRef, name: '' },
          relation: '相关',
          weight: 'minor',
        },
      ],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }

    const fsb = convertGraphToFSB(meta, roomRef)

    expect(fsb.children?.['32']).toEqual({
      path: '32',
      name: '32',
      hasChildren: false,
      x: 179,
      y: 464,
    })
    expect(fsb.children?.[childRef]).toBeUndefined()
    expect(fsb.edges?.[0]).toMatchObject({ source: '32', target: '32' })
  })

  it('reads room-relative children under filesystem-like refs into canonical refs', () => {
    const roomRef = '../../../Code/topomind_cc/测试1'

    const meta = convertFSBToGraph({
      children: {
        32: { path: '32', name: '32', x: 179, y: 464 },
      },
      edges: [
        { id: 'e1', source: '32', target: '32', relation: '相关', weight: 'minor' },
      ],
      zoom: 1,
      pan: { x: 0, y: 0 },
    }, roomRef)

    const childRef = `${roomRef}/32`
    expect(meta.nodes[childRef]).toMatchObject({
      id: childRef,
      card: { ref: childRef, name: '32' },
      position: { x: 179, y: 464 },
    })
    expect(meta.edges[0]).toMatchObject({
      source: { ref: childRef },
      target: { ref: childRef },
    })
  })

  it('keeps compatibility with old KB-relative nested child refs', () => {
    const meta = convertFSBToGraph({
      children: {
        'Parent/Child': { path: 'Parent/Child', name: 'Child' },
      },
      edges: [
        { id: 'e1', source: 'Parent/Child', target: 'Parent/Child', relation: '相关', weight: 'minor' },
      ],
      zoom: 1,
      pan: { x: 0, y: 0 },
    }, 'KB/Parent')

    expect(meta.nodes['KB/Parent/Child']).toMatchObject({
      id: 'KB/Parent/Child',
      card: { ref: 'KB/Parent/Child', name: 'Child' },
    })
    expect(meta.edges[0]).toMatchObject({
      source: { ref: 'KB/Parent/Child' },
      target: { ref: 'KB/Parent/Child' },
    })
  })
})
