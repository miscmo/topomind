import type { KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import { useGraphStore } from '../../stores/graphStore'

export interface SelectionOperationsDeps {
  tabId: string
}

export function buildSelectionOperations(deps: SelectionOperationsDeps) {
  const {
    tabId,
  } = deps

  const selectNode = (nodeId: string) => {
    const store = useGraphStore.getState()
    const nextNodes = store.nodes.map(n => ({
      ...n,
      selected: n.id === nodeId
    }))
    store.setNodes(nextNodes)

    logAction('节点:选中', 'graphOperations', {
      nodeId,
      label: store.nodesMap.get(nodeId)?.data.label,
      path: nodeId,
    })
  }

  const deselectNode = () => {
    const store = useGraphStore.getState()
    const nextNodes = store.nodes.map(n => {
      if (!n.selected) return n
      return { ...n, selected: false }
    })
    store.setNodes(nextNodes)
  }

  return {
    selectNode,
    deselectNode,
  }
}
