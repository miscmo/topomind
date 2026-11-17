/**
 * 跨房间移动的操作历史（纯运行时：不落盘、不进 zundo）。
 *
 * 为什么单独一份栈：移动是后端原子 relocate（改磁盘目录 + 两个房间的 meta），
 * 之后 loadRoom() 会清掉 zundo 历史，graphStore 的快照也无法把目录搬回去。
 * 所以这里只记「反向执行一次移动所需的全部信息」，提供撤销 / 前进（重做）。
 *
 * 栈里保存的始终是**当前磁盘状态**对应的 basename 与原坐标：
 * 每次撤销 / 前进成功后，用后端返回的真实 result 覆盖条目，下一次反向操作
 * 才能准确找到节点（目标房间同名冲突时 basename 会被自动改名）。
 */
import { create } from 'zustand'
import type { MoveTopoNodesToRoomResult } from '../../../../core/storage'

export interface NodeMoveHistoryEntry extends MoveTopoNodesToRoomResult {
  /** 目标房间显示名，只用于按钮 tooltip */
  targetLabel: string
  at: number
}

interface NodeMoveHistoryState {
  undoStack: NodeMoveHistoryEntry[]
  redoStack: NodeMoveHistoryEntry[]
  /** 后端操作进行中：锁住按钮，避免连点造成两次 relocate */
  busy: boolean
  /** 一次新的移动：进 undo 栈，同时让旧的重做分支失效（标准 undo/redo 语义） */
  pushMove: (entry: NodeMoveHistoryEntry) => void
  setBusy: (busy: boolean) => void
  /** 撤销成功后：undo 栈顶出栈，带着更新后的条目压入 redo 栈顶 */
  commitUndo: (next: NodeMoveHistoryEntry) => void
  /** 前进成功后：redo 栈顶出栈，带着更新后的条目压回 undo 栈顶 */
  commitRedo: (next: NodeMoveHistoryEntry) => void
  clear: () => void
}

const MAX_HISTORY = 20

export const useNodeMoveHistoryStore = create<NodeMoveHistoryState>((set) => ({
  undoStack: [],
  redoStack: [],
  busy: false,
  pushMove: (entry) => set((state) => ({
    undoStack: [...state.undoStack, entry].slice(-MAX_HISTORY),
    redoStack: [],
  })),
  setBusy: (busy) => set({ busy }),
  commitUndo: (next) => set((state) => ({
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, next].slice(-MAX_HISTORY),
  })),
  commitRedo: (next) => set((state) => ({
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, next].slice(-MAX_HISTORY),
  })),
  clear: () => set({ undoStack: [], redoStack: [], busy: false }),
}))

/** 按钮 tooltip：说明这一步会撤销 / 重做什么。 */
export function describeMoveEntry(entry: NodeMoveHistoryEntry | undefined, kind: 'undo' | 'redo'): string {
  if (!entry) {
    return kind === 'undo' ? '暂无可撤销的节点移动' : '暂无可前进的节点移动'
  }
  const verb = kind === 'undo' ? '撤销' : '重做'
  return `${verb}：移动 ${entry.moved.length} 个节点到「${entry.targetLabel}」`
}
