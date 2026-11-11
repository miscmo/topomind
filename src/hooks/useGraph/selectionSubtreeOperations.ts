/**
 * 「选中子树」写回层：只改 nodes[].selected 这个运行时字段。
 *
 * 与 selectNode 同构：走 store.setNodes 让 selectedNodeIds / selectedNodes /
 * selectedNodeCount 一次同步派生。不进 undo（areNodesEqual 忽略 selected）、
 * 不落盘（selected 是运行时字段）、不进只读写闸门（选中是视图态，不是编辑）。
 */
import type { StoreApi } from 'zustand'
import { logAction } from '../../core/log-backend'
import { applySubtreeSelection } from '../../domain/graph/selectSubtree'
import type { GraphState } from '../../stores/graphStore'

export interface SelectionSubtreeOpsDeps {
  storeApi: StoreApi<GraphState>
}

export function buildSelectionSubtreeOperations({ storeApi }: SelectionSubtreeOpsDeps) {
  /** rootIds 省略时以「当前选中的全部节点」为根；返回 false = 没有有效根。 */
  const selectSubtree = (rootIds?: readonly string[]): boolean => {
    const store = storeApi.getState()
    const roots: readonly string[] = rootIds && rootIds.length > 0 ? rootIds : store.selectedNodeIds
    const patch = applySubtreeSelection(store.nodes, store.edges, roots)
    if (!patch) return false
    if (patch.changed) store.setNodes(patch.nodes)
    logAction('节点:选中子树', 'graphOperations', {
      roots: [...roots],
      count: patch.subtreeIds.length,
      added: patch.addedIds.length,
    })
    return true
  }

  return { selectSubtree }
}
