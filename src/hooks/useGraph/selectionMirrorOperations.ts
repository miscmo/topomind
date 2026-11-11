/**
 * 多选区域水平镜像：把 domain 纯函数的结果一次性写回 store 并保存。
 *
 * 关键点：
 *  - 节点与边必须落在**同一条 undo 历史**里，否则撤销一次只回退坐标、
 *    连线锚点还留在翻转后的状态。用 pause → 两次 set → resume → 手动 commit
 *    合并成一步（与拖动/缩放的 begin/finishInteractionHistory 同一套机制）。
 *  - 只改 position 与边 data 的少量字段，其余字段由纯函数展开透传；
 *    不新增任何落盘字段，也不碰节点/边 7 处字段白名单。
 *  - 保存走 saveLater：captureSaveSnapshot 读的是 set 之后的最新 store。
 */
import type { StoreApi } from 'zustand'
import {
  captureGraphHistorySnapshot,
  commitGraphHistorySnapshot,
  type GraphState,
  type GraphStoreApi,
} from '../../stores/graphStore'
import { applyHorizontalMirror } from '../../domain/graph/mirrorSelection'

export interface SelectionMirrorOperationsDeps {
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  saveLater: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
}

export function buildSelectionMirrorOperations({
  getActiveGraphSession,
  saveLater,
  storeApi,
}: SelectionMirrorOperationsDeps) {
  const flipSelectionHorizontally = async (): Promise<boolean> => {
    const store = storeApi.getState()
    // selectedNodeIds 与 React Flow 的 .selected 同源；不足 2 个节点时纯函数返回 null。
    const result = applyHorizontalMirror(store.nodes, store.edges, store.selectedNodeIds)
    if (!result) return false

    const graphStoreApi = storeApi as GraphStoreApi
    const baseline = captureGraphHistorySnapshot(store)
    const temporalState = graphStoreApi.temporal.getState()
    temporalState.pause()
    try {
      // 保留 selected：翻转完菜单仍可用，再点一次即可翻回去。
      store.setNodesPreservingSelection(result.nodes, result.flippedNodeIds)
      store.setEdges(result.edges)
    } finally {
      temporalState.resume()
    }
    commitGraphHistorySnapshot(graphStoreApi, baseline)

    const session = getActiveGraphSession()
    const dirPath = session.roomPath || session.kbPath || ''
    if (dirPath) await saveLater(dirPath)
    return true
  }

  return { flipSelectionHorizontally }
}
