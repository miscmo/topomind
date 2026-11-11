import { create } from 'zustand'
import type { EdgeRelation } from '../types'

/**
 * 新建连线的「必选关系」浮层状态。
 *
 * 【用户决策 2026-11-08】每次手动画线都必须显式选择「关联 / 从属」，未选不落盘。
 * 这里只存一个待确认的连线与提交回调（回调是闭包，不持久化、不进 IPC），
 * 建边逻辑仍留在 graphEventHandlers.onConnect 一处，避免两处各写一套。
 */
export interface PendingEdgeRelationChoice {
  source: string
  target: string
  /** 从属关系不可用时的原因文案；null 表示可用 */
  subordinateBlockedReason: string | null
  onConfirm: (relation: EdgeRelation) => void
}

interface EdgeRelationPickerState {
  pending: PendingEdgeRelationChoice | null
  open: (pending: PendingEdgeRelationChoice) => void
  close: () => void
}

export const useEdgeRelationPickerStore = create<EdgeRelationPickerState>((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}))
