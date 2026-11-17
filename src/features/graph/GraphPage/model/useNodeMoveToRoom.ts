/**
 * useNodeMoveToRoom — 跨房间移动节点（批量）的协调器。
 *
 * 职责：
 * - 右键节点时解析待移动集合（若右键节点在多选中，则整批移动，否则仅该节点）；
 *   画布空白处 / 多选选区包围盒右键时走「移动选中节点」入口，直接用冻结的选中快照。
 * - 三个入口统一走 buildMoveState：选中集合由调用方在**打开菜单那一刻**冻结，
 *   不再在点击菜单项时回读 store，避免右键期间选中态被任何副作用改写导致「只移动一个节点」。
 * - 调用后端原子操作 storage.moveTopoNodesToRoom 完成物理 relocate + 连线重分配。
 * - 每次成功移动压入 nodeMoveHistoryStore；撤销 / 前进（重做）都从栈顶取，
 *   toast 的「撤销」和画布状态面板的常驻按钮共用同一入口，不受 toast 自动消失影响。
 * - 所有刷新一律走 graph.refreshCurrentRoom()：撤销/前进只改磁盘，不该把用户
 *   视角切到源房间或目标房间，否则画布与面包屑会不一致、房间导航也会失效。
 */
import { useCallback, useState } from 'react'
import { useStorage } from '../../../../core/storage'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
import { logAction } from '../../../../core/log-backend'
import { normalizeRef } from '../../../../domain/graph/path-utils'
import { useNodeMoveHistoryStore, type NodeMoveHistoryEntry } from './nodeMoveHistoryStore'

interface MoveDialogState {
  nodeIds: string[]
  sourceRoomPath: string
  kbPath: string
}

export function useNodeMoveToRoom({ graph }: { graph: GraphContextValue }) {
  const storage = useStorage()
  const graphStoreApi = useGraphStoreApi()
  const [moveState, setMoveState] = useState<MoveDialogState | null>(null)

  /** 唯一的移动集合构造点：只认显式传入的 nodeIds，不读当前选中态。 */
  const buildMoveState = useCallback((rawIds: readonly string[]): MoveDialogState | null => {
    const nodeIds = Array.from(new Set(rawIds.map(normalizeRef).filter(Boolean)))
    if (nodeIds.length === 0) {
      toast({ level: 'error', title: '无法移动', message: '请先选中要移动的节点' })
      return null
    }
    const state = graphStoreApi.getState()
    const node = state.nodesMap.get(nodeIds[0])
    const sourceRoomPath = typeof node?.data?.parent === 'string' && node.data.parent ? node.data.parent : ''
    if (!sourceRoomPath) {
      toast({ level: 'error', title: '无法移动', message: '无法确定节点所在房间' })
      return null
    }
    return { nodeIds, sourceRoomPath, kbPath: sourceRoomPath.split('/')[0] }
  }, [graphStoreApi])

  /**
   * 节点右键入口。selectedSnapshot 是打开菜单时冻结的选中集合；
   * 右键落在集合内 → 整批移动，落在集合外 → 只移动该节点。
   */
  const openMoveToRoom = useCallback((nodeId: string, selectedSnapshot?: readonly string[]) => {
    const state = graphStoreApi.getState()
    const selected = (selectedSnapshot ?? state.selectedNodeIds).map(normalizeRef).filter(Boolean)
    const anchorId = normalizeRef(nodeId)
    if (!anchorId) return
    const nodeIds = selected.includes(anchorId) ? selected : [anchorId]
    const next = buildMoveState(nodeIds)
    if (next) setMoveState(next)
  }, [graphStoreApi, buildMoveState])

  /** 画布空白处 / 多选选区包围盒右键：直接用冻结的选中快照整批移动。 */
  const openMoveIdsToRoom = useCallback((selectedSnapshot: readonly string[]) => {
    const next = buildMoveState(selectedSnapshot)
    if (next) setMoveState(next)
  }, [buildMoveState])

  const closeMoveToRoom = useCallback(() => setMoveState(null), [])

  /**
   * 撤销栈顶移动：把节点从目标房间搬回源房间，并把移动前的原坐标写回，
   * 避免节点被「再平移一次」。成功后条目移到 redo 栈，可再点「前进」重做。
   */
  const undoMove = useCallback(async () => {
    const history = useNodeMoveHistoryStore.getState()
    if (history.busy) return
    const entry = history.undoStack[history.undoStack.length - 1]
    if (!entry) {
      toast({ level: 'info', title: '没有可撤销的移动', message: '节点移动历史为空' })
      return
    }
    history.setBusy(true)
    try {
      const result = await storage.moveTopoNodesToRoom(
        entry.targetRoomPath,
        entry.moved,
        entry.sourceRoomPath,
        { positionsByNode: entry.positions },
      )
      // 原地刷新用户当前所在的房间，不切视角、不改 tab 会话的 roomPath。
      await graph.refreshCurrentRoom()
      // 只更新 basename：房间方向（source → target）永远保持原始移动方向，
      // 前进时会按这个方向再搬一次。
      useNodeMoveHistoryStore.getState().commitUndo({ ...entry, moved: result.moved })
      toast({ level: 'info', title: '已撤销移动', message: `已将 ${result.moved.length} 个节点移回原房间，可点「前进」重做` })
      logAction('节点:跨房间移动-撤销', 'useNodeMoveToRoom', {
        sourceRoomPath: entry.targetRoomPath, targetRoomPath: entry.sourceRoomPath, moved: result.moved,
      })
    } catch (e) {
      toast({ level: 'error', title: '撤销失败', message: e instanceof Error ? e.message : String(e) })
    } finally {
      useNodeMoveHistoryStore.getState().setBusy(false)
    }
  }, [storage, graph])

  /**
   * 前进（重做）：把节点重新搬回目标房间。撤销已经把目标房间恢复到移动前状态，
   * 所以后端重新计算的空白落点与第一次移动完全一致，不需要额外记录目标坐标。
   */
  const redoMove = useCallback(async () => {
    const history = useNodeMoveHistoryStore.getState()
    if (history.busy) return
    const entry = history.redoStack[history.redoStack.length - 1]
    if (!entry) {
      toast({ level: 'info', title: '没有可前进的移动', message: '先撤销一次节点移动' })
      return
    }
    history.setBusy(true)
    try {
      const result = await storage.moveTopoNodesToRoom(entry.sourceRoomPath, entry.moved, entry.targetRoomPath)
      await graph.refreshCurrentRoom()
      // 前进后的 result.positions 是「移动前在源房间的坐标」，正好供下一次撤销写回。
      useNodeMoveHistoryStore.getState().commitRedo({
        ...entry, moved: result.moved, positions: result.positions,
      })
      toast({ level: 'info', title: '已重做移动', message: `已将 ${result.moved.length} 个节点重新移入「${entry.targetLabel}」` })
      logAction('节点:跨房间移动-前进', 'useNodeMoveToRoom', {
        sourceRoomPath: entry.sourceRoomPath, targetRoomPath: entry.targetRoomPath, moved: result.moved,
      })
    } catch (e) {
      toast({ level: 'error', title: '前进失败', message: e instanceof Error ? e.message : String(e) })
    } finally {
      useNodeMoveHistoryStore.getState().setBusy(false)
    }
  }, [storage, graph])

  const handleMoveNodesToRoom = useCallback(async (targetRoomPath: string) => {
    if (!moveState) return
    const { nodeIds, sourceRoomPath } = moveState
    try {
      const result = await storage.moveTopoNodesToRoom(sourceRoomPath, nodeIds, targetRoomPath)
      // 刷新用户当前房间（停留原地，不跳转、不切房间）
      await graph.refreshCurrentRoom()
      const entry: NodeMoveHistoryEntry = {
        ...result,
        targetLabel: targetRoomPath.split('/').pop() || targetRoomPath,
        at: Date.now(),
      }
      useNodeMoveHistoryStore.getState().pushMove(entry)
      const parts = [
        `移动 ${result.moved.length} 个节点`,
        result.keptEdges > 0 ? `保留 ${result.keptEdges} 条内部连线` : '',
        result.droppedEdges > 0 ? `丢弃 ${result.droppedEdges} 条边界连线` : '',
        '已放入目标房间空白区域',
      ].filter(Boolean).join('，')
      toast({
        level: 'info',
        title: `已移动到「${targetRoomPath.split('/').pop()}」`,
        message: parts,
        duration: 6000,
        // 与画布状态面板的常驻按钮共用同一个历史栈，toast 消失后仍可撤销。
        action: { label: '撤销', onClick: () => void undoMove() },
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

  return {
    moveState,
    openMoveToRoom,
    openMoveIdsToRoom,
    closeMoveToRoom,
    handleMoveNodesToRoom,
    onMoveUndo: undoMove,
    onMoveRedo: redoMove,
  }
}
