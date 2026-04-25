import type { KnowledgeNode } from '../../types'

export function applySearchHighlight(nodes: KnowledgeNode[], query: string): KnowledgeNode[] {
  const q = query.toLowerCase().trim()
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      searchMatch: q ? node.data.label.toLowerCase().includes(q) : false,
    },
  }))
}
