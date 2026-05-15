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

  const selectNode = (nodeId: string, multiSelect = false) => {
    const store = storeApi.getState()
    let changed = false
    const nextNodes = store.nodes.map(n => {
      const shouldSelect = n.id === nodeId || (multiSelect && n.selected)
      if ((n.selected ?? false) === shouldSelect) return n
      changed = true
      return { ...n, selected: shouldSelect }
    })
    if (changed) store.setNodes(nextNodes)

    logAction('节点:选中', 'graphOperations', {
      nodeId,
      label: store.nodesMap.get(nodeId)?.data.label,
      path: nodeId,
      multiSelect
    })
  }

  const deselectNode = () => {
    const store = storeApi.getState()
    let changed = false
    const nextNodes = store.nodes.map(n => {
      if (!n.selected) return n
      changed = true
      return { ...n, selected: false }
    })
    if (changed) store.setNodes(nextNodes)
  }

  return {
    selectNode,
    deselectNode,
  }
}
