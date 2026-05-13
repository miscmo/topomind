import type { KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'

export interface SelectionOperationsDeps {
  nodesMapRef: React.MutableRefObject<Map<string, KnowledgeNode>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  setActiveSelectedNodeId: (nodeId: string | null) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
}

export function buildSelectionOperations(deps: SelectionOperationsDeps) {
  const {
    nodesMapRef,
    nodesRef,
    setActiveSelectedNodeId,
    updateSelectedNode,
  } = deps

  const selectNode = (nodeId: string) => {
    setActiveSelectedNodeId(nodeId)
    updateSelectedNode(nodesRef.current, nodeId)
    logAction('节点:选中', 'graphOperations', {
      nodeId,
      label: nodesMapRef.current.get(nodeId)?.data.label,
      path: nodeId,
    })
  }

  const deselectNode = () => {
    setActiveSelectedNodeId(null)
    updateSelectedNode(nodesRef.current, null)
  }

  return {
    selectNode,
    deselectNode,
  }
}
