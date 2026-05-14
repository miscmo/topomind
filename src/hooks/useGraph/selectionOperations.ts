import type { KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import { useGraphStore } from '../../stores/graphStore'

import { tabStore } from '../../stores/tabStore'

export interface SelectionOperationsDeps {
  tabId: string
}

export function buildSelectionOperations(deps: SelectionOperationsDeps) {
  const {
    tabId,
  } = deps

  const selectNode = (nodeId: string) => {
    tabStore.getState().setTabSelectedNode(tabId, nodeId)
    const store = useGraphStore.getState()
    logAction('节点:选中', 'graphOperations', {
      nodeId,
      label: store.nodesMap.get(nodeId)?.data.label,
      path: nodeId,
    })
  }

  const deselectNode = () => {
    tabStore.getState().setTabSelectedNode(tabId, null)
  }

  return {
    selectNode,
    deselectNode,
  }
}
