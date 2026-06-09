import type { KnowledgeEdge, KnowledgeNode } from '../../types'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}
