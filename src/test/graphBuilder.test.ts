/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { generateId, buildMetaFromNodesEdges, buildEdges } from '../hooks/useGraph/graphBuilder'
import type { KnowledgeNode, KnowledgeEdge } from '../types'

// Mock DOMAIN_COLORS import (not needed for pure functions we're testing)
vi.mock('../types', async () => {
  const actual = await vi.importActual('../types')
  return {
    ...actual as object,
    DOMAIN_COLORS: ['#6366f1', '#ec4899', '#f59e0b', '#10b981'],
  }
})

describe('graphBuilder', () => {
  describe('generateId', () => {
    it('returns string starting with the given prefix', () => {
      const id = generateId('node')
      expect(id.startsWith('node')).toBe(true)
    })

    it('returns an id with 6 random characters appended', () => {
      const id = generateId('edge')
      // prefix + 6 chars
      expect(id.length).toBe('edge'.length + 6)
    })

    it('generates unique ids across multiple calls', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateId('test'))
      }
      // With 6 random chars from 36-char alphabet, 100 calls should all be unique
      expect(ids.size).toBe(100)
    })

    it('uses only alphanumeric characters after prefix', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateId('x')
        const suffix = id.slice(1)
        expect(suffix).toMatch(/^[a-z0-9]{6}$/)
      }
    })
  })

  describe('buildMetaFromNodesEdges', () => {
    it('returns empty children and edges when given empty arrays', () => {
      const result = buildMetaFromNodesEdges([], [])
      expect(result.children).toEqual({})
      expect(result.edges).toEqual([])
    })

    it('serializes nodes to children map with name-only keys', () => {
      const nodes: KnowledgeNode[] = [
        {
          id: 'kb/父节点',
          type: 'knowledgeCard',
          position: { x: 0, y: 0 },
          data: { label: '父节点', path: 'kb/父节点', hasChildren: true, nodeType: 'container' },
        },
        {
          id: 'kb/子节点A',
          type: 'knowledgeCard',
          position: { x: 0, y: 0 },
          data: { label: '子节点A', path: 'kb/子节点A', hasChildren: false, nodeType: 'leaf' },
        },
      ]
      const result = buildMetaFromNodesEdges(nodes, [])
      expect(result.children).toEqual({
        '父节点': { name: '父节点' },
        '子节点A': { name: '子节点A' },
      })
    })

    it('uses full path as key for root-level nodes', () => {
      const nodes: KnowledgeNode[] = [
        {
          id: 'top-level-node',
          type: 'knowledgeCard',
          position: { x: 0, y: 0 },
          data: { label: '顶层节点', path: 'top-level-node', hasChildren: false, nodeType: 'leaf' },
        },
      ]
      const result = buildMetaFromNodesEdges(nodes, [])
      expect(result.children).toEqual({
        'top-level-node': { name: '顶层节点' },
      })
    })

    it('serializes edges with default relation and weight', () => {
      const nodes: KnowledgeNode[] = [
        {
          id: 'node1',
          type: 'knowledgeCard',
          position: { x: 0, y: 0 },
          data: { label: '节点1', path: 'node1', hasChildren: false, nodeType: 'leaf' },
        },
        {
          id: 'node2',
          type: 'knowledgeCard',
          position: { x: 0, y: 0 },
          data: { label: '节点2', path: 'node2', hasChildren: false, nodeType: 'leaf' },
        },
      ]
      const edges: KnowledgeEdge[] = [
        {
          id: 'edge1',
          source: 'node1',
          target: 'node2',
          type: 'smoothstep',
          data: { relation: '演进', weight: 'main' },
        },
      ]
      const result = buildMetaFromNodesEdges(nodes, edges)
      expect(result.edges).toEqual([
        { id: 'edge1', source: 'node1', target: 'node2', relation: '演进', weight: 'main' },
      ])
    })

    it('uses default relation and weight when edge data is missing', () => {
      const edges: KnowledgeEdge[] = [
        {
          id: 'edge1',
          source: 'a',
          target: 'b',
          type: 'smoothstep',
          // data is undefined
        },
      ]
      const result = buildMetaFromNodesEdges([], edges)
      expect(result.edges[0]).toEqual({
        id: 'edge1',
        source: 'a',
        target: 'b',
        relation: '相关',
        weight: 'minor',
      })
    })

    it('includes zoom and pan when provided', () => {
      const result = buildMetaFromNodesEdges([], [], 1.5, { x: 100, y: 200 })
      expect(result.zoom).toBe(1.5)
      expect(result.pan).toEqual({ x: 100, y: 200 })
    })

    it('includes zoom and pan when null is explicitly passed', () => {
      const result = buildMetaFromNodesEdges([], [], null, null)
      expect(result.zoom).toBeNull()
      expect(result.pan).toBeNull()
    })

    it('preserves highlighted and faded on edge round-trip serialization', () => {
      const edges: KnowledgeEdge[] = [
        {
          id: 'e1',
          source: 'node1',
          target: 'node2',
          type: 'smoothstep',
          data: { relation: '相关', weight: 'minor', highlighted: true, faded: false },
        },
        {
          id: 'e2',
          source: 'node2',
          target: 'node3',
          type: 'smoothstep',
          data: { relation: '演进', weight: 'main', highlighted: false, faded: true },
        },
      ]
      const result = buildMetaFromNodesEdges([], edges)
      expect(result.edges[0]).toMatchObject({
        id: 'e1',
        source: 'node1',
        target: 'node2',
        relation: '相关',
        weight: 'minor',
        highlighted: true,
        faded: false,
      })
      expect(result.edges[1]).toMatchObject({
        id: 'e2',
        source: 'node2',
        target: 'node3',
        relation: '演进',
        weight: 'main',
        highlighted: false,
        faded: true,
      })
    })
  })

  describe('buildEdges', () => {
    it('returns empty array when meta has no edges', () => {
      const result = buildEdges({})
      expect(result).toEqual([])
    })

    it('maps edges from GraphMeta format to KnowledgeEdge format', () => {
      const result = buildEdges({
        edges: [
          { id: 'e1', source: 'a', target: 'b', relation: '依赖', weight: 'main' },
          { id: 'e2', source: 'b', target: 'c', relation: '演进', weight: 'minor' },
        ],
      })
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'e1',
        source: 'a',
        target: 'b',
        type: 'smoothstep',
        animated: true,
        data: { relation: '依赖', weight: 'main', highlighted: false, faded: false },
      })
      expect(result[1]).toMatchObject({
        id: 'e2',
        source: 'b',
        target: 'c',
        animated: false,
        data: { relation: '演进', weight: 'minor', highlighted: false, faded: false },
      })
    })

    it('sets animated=true only for main weight edges', () => {
      const mainEdge = buildEdges({ edges: [{ id: 'e1', source: 'a', target: 'b', relation: '演进', weight: 'main' }] })
      const minorEdge = buildEdges({ edges: [{ id: 'e2', source: 'a', target: 'b', relation: '演进', weight: 'minor' }] })
      expect(mainEdge[0].animated).toBe(true)
      expect(minorEdge[0].animated).toBe(false)
    })

    it('restores highlighted and faded from persisted _graph.json metadata', () => {
      const result = buildEdges({
        edges: [
          { id: 'e1', source: 'a', target: 'b', relation: '相关', weight: 'minor', highlighted: true, faded: false },
          { id: 'e2', source: 'b', target: 'c', relation: '演进', weight: 'main', highlighted: false, faded: true },
          // No highlighted/faded — should default to false (backward compat)
          { id: 'e3', source: 'c', target: 'd', relation: '依赖', weight: 'minor' },
        ],
      })
      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({
        data: { highlighted: true, faded: false },
      })
      expect(result[1]).toMatchObject({
        data: { highlighted: false, faded: true },
      })
      expect(result[2]).toMatchObject({
        data: { highlighted: false, faded: false },
      })
    })
  })
})
