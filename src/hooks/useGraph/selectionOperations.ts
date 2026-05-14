import type { KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface SelectionOpsDeps {
  tabId: string
  storeApi: StoreApi<GraphState>
}

export function buildSelectionOperations(deps: SelectionOpsDeps) {
  const {
    tabId,
    storeApi,
  } = deps

  const selectNode = (nodeId: string) => {
    const store = storeApi.getState()
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
    const store = storeApi.getState()
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
