/**
 * 左侧节点树排序写入（唯一入口）。
 * 只改 data.treeOrder：一次 setNodes + 后台合并落盘，绝不触发整房间重载，
 * 也不碰 position / 尺寸 / 选中态。写闸门由 useGraph 统一包住。
 */
import { applyTreeOrderPatch } from './graphBuilder'
import { CANVAS_OPERATIONS } from '@/shared/observability/performanceContract'
import { startCanvasSpan } from './canvasPerformanceContext'
import type { GraphStoreApi } from '../../stores/graphStore'

export interface NodeTreeOrderUpdate {
  id: string
  treeOrder: number
}

interface NodeTreeOpsDeps {
  getActiveGraphSession: () => { roomPath?: string | null } | null
  saveLater: (dirPath: string) => Promise<void>
  storeApi: GraphStoreApi
}

export function buildNodeTreeOperations({ getActiveGraphSession, saveLater, storeApi }: NodeTreeOpsDeps) {
  const setNodeTreeOrder = async (updates: readonly NodeTreeOrderUpdate[]): Promise<boolean> => {
    if (updates.length === 0) return false
    const state = storeApi.getState()
    const nextNodes = applyTreeOrderPatch(state.nodes, updates)
    if (!nextNodes) return false
    const session = getActiveGraphSession()
    const perfSpan = startCanvasSpan(storeApi, {
      operation: CANVAS_OPERATIONS.treeOrder,
      roomPath: session?.roomPath ?? '',
      affectedCount: updates.length,
    })
    state.setNodes(nextNodes)
    perfSpan.end()
    if (session?.roomPath) void saveLater(session.roomPath)
    return true
  }

  return { setNodeTreeOrder }
}
