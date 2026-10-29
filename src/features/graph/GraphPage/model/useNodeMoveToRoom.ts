/**
 * useNodeMoveToRoom — 跨房间移动节点（批量）的协调器。
 *
 * 职责：
 * - 右键节点时解析待移动集合（若右键节点在框选中，则整批移动，否则仅该节点）。
 * - 调用后端原子操作 storage.moveTopoNodesToRoom 完成物理 relocate + 连线重分配。
 * - 刷新源房间（留在原房），弹成功 toast 并支持撤销（把节点从目标移回源）。
 */
import { useCallback, useState } from 'react'
import { useStorage } from '../../../../core/storage'
import type { MoveTopoNodesToRoomResult } from '../../../../core/storage'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { toast } from '../../../../stores/toastStore'
import { logAction } from '../../../../core/log-backend'
import { normalizeRef } from '../../../../domain/graph/path-utils'

interface MoveDialogState {
  nodeIds: string[]
  sourceRoomPath: string
  kbPath: string
}

export function useNodeMoveToRoom({ graph }: { graph: GraphContextValue }) {
  const storage = useStorage()
  const graphStoreApi = useGraphStoreApi()
  const [moveState, setMoveState] = useState<MoveDialogState | null>(null)

  const openMoveToRoom = useCallback((nodeId: string) => {
    const state = graphStoreApi.getState()
    const node = state.nodesMap.get(nodeId)
    const sourceRoomPath = typeof node?.data?.parent === 'string' && node.data.parent ? node.data.parent : ''
    if (!sourceRoomPath) {
      toast({ level: 'error', title: '无法移动', message: '无法确定节点所在房间' })
      return
    }
    const selected = state.selectedNodeIds.map(normalizeRef)
    const nodeIds = selected.includes(normalizeRef(nodeId)) && selected.length > 0
      ? selected
      : [normalizeRef(nodeId)]
    const kbPath = sourceRoomPath.split('/')[0]
    setMoveState({ nodeIds, sourceRoomPath, kbPath })
  }, [graphStoreApi])

  const closeMoveToRoom = useCallback(() => setMoveState(null), [])

  const undoMove = useCallback(async (result: MoveTopoNodesToRoomResult) => {
    try {
      await storage.moveTopoNodesToRoom(result.targetRoomPath, result.moved, result.sourceRoomPath)
      await graph.loadRoom(result.sourceRoomPath)
      toast({ level: 'info', title: '已撤销移动', message: `已将 ${result.moved.length} 个节点移回原房间` })
    } catch (e) {
      toast({ level: 'error', title: '撤销失败', message: e instanceof Error ? e.message : String(e) })
    }
  }, [storage, graph])

  const handleMoveNodesToRoom = useCallback(async (targetRoomPath: string) => {
    if (!moveState) return
    const { nodeIds, sourceRoomPath } = moveState
    try {
      const result = await storage.moveTopoNodesToRoom(sourceRoomPath, nodeIds, targetRoomPath)
      // 刷新源房间（停留原房，不跳转）
      await graph.loadRoom(sourceRoomPath)
      const parts = [
        `移动 ${result.moved.length} 个节点`,
        result.keptEdges > 0 ? `保留 ${result.keptEdges} 条内部连线` : '',
        result.droppedEdges > 0 ? `丢弃 ${result.droppedEdges} 条边界连线` : '',
      ].filter(Boolean).join('，')
      toast({
        level: 'info',
        title: `已移动到「${targetRoomPath.split('/').pop()}」`,
        message: parts,
        duration: 6000,
        action: { label: '撤销', onClick: () => void undoMove(result) },
      })
      logAction('节点:跨房间移动', 'useNodeMoveToRoom', {
        sourceRoomPath,
        targetRoomPath,
        nodeIds,
        moved: result.moved,
        keptEdges: result.keptEdges,
        droppedEdges: result.droppedEdges,
      })
    } catch (e) {
      toast({ level: 'error', title: '移动失败', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setMoveState(null)
    }
  }, [moveState, storage, graph, undoMove])

  return { moveState, openMoveToRoom, closeMoveToRoom, handleMoveNodesToRoom }
}
