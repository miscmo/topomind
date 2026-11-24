import { recordStep } from '../../core/traceBuffer'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface SelectionOpsDeps {
  tabId: string
  storeApi: StoreApi<GraphState>
}

export function buildSelectionOperations(deps: SelectionOpsDeps) {
  const {
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

    // P7：选中态是运行时视图字段（不落盘、不进 undo），不是一条需要落盘的事实。
    // 只记内存步骤，异常 / 诊断包导出时按需 dump，避免一次点击写 3 条 node.select。
    recordStep({
      name: 'node.select',
      outcome: changed ? 'changed' : 'unchanged',
      params: { nodeId, multiSelect },
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
