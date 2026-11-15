import { create } from 'zustand'
import type { EdgeRelation } from '../types'

/** 屏幕坐标（clientX/clientY）：两个轻量浮层都贴在鼠标事件的发生处 */
export interface EdgePopupAnchor {
  x: number
  y: number
}

/**
 * 新建连线的「必选关系」浮层状态。
 *
 * 【用户决策 2026-11-08】每次手动画线都必须显式选择「关联 / 从属」，未选不落盘。
 * 【用户决策 2026-11-12】浮层不再是屏幕居中的模态框，而是贴在**连线终点**的
 * 轻量菜单，anchor 就是松手那一刻的鼠标 / 触点坐标。
 * 这里只存一个待确认的连线与提交回调（回调是闭包，不持久化、不进 IPC），
 * 建边逻辑仍留在 graphEventHandlers.onConnect 一处，避免两处各写一套。
 */
export interface PendingEdgeRelationChoice {
  source: string
  target: string
  /** 从属关系不可用时的原因文案；null 表示可用 */
  subordinateBlockedReason: string | null
  /** 连线终点（松手处）的屏幕坐标 */
  anchor: EdgePopupAnchor
  onConfirm: (relation: EdgeRelation) => void
}

interface EdgeRelationPickerState {
  pending: PendingEdgeRelationChoice | null
  open: (pending: PendingEdgeRelationChoice) => void
  /** onConnectEnd 拿到更精确的事件坐标时纠偏一次；没有 pending 时是 no-op */
  setAnchor: (anchor: EdgePopupAnchor) => void
  close: () => void
}

export const useEdgeRelationPickerStore = create<EdgeRelationPickerState>((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  setAnchor: (anchor) => set((state) => (
    state.pending ? { pending: { ...state.pending, anchor } } : state
  )),
  close: () => set({ pending: null }),
}))

/** 双击已有连线时打开的轻量关系编辑器（编辑本条边的自定义关系名 / 切换关系） */
export interface EditingEdgeRelation {
  edgeId: string
  anchor: EdgePopupAnchor
}

interface EdgeRelationEditorState {
  editing: EditingEdgeRelation | null
  open: (editing: EditingEdgeRelation) => void
  close: () => void
}

export const useEdgeRelationEditorStore = create<EdgeRelationEditorState>((set) => ({
  editing: null,
  open: (editing) => set({ editing }),
  close: () => set({ editing: null }),
}))
