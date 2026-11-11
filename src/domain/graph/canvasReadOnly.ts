/**
 * 画布只读闸门（纯函数：无 DOM / 无 React / 无 IPC，可被 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-11】「当画布比例缩小、有节点消失时，整个画布不能有任何编辑操作
 * （移动节点、移动连线、增删连线、重命名节点等），只有比例恢复 100% 之后才可编辑」。
 * 根因：远景下坐标随 viewport 收缩、字形壳被补偿放大、部分节点被 LOD 隐藏，
 * 画布上的位置信息已经失真，此时落笔会改到看不见 / 看不准的对象上。
 *
 * 判定刻意用「或」而不是「与」：
 *   - 显示比 < 100%：哪怕这个房间恰好零隐藏（LOD off / 节点极少 / 全部层级常驻），
 *     坐标仍被缩放，编辑依旧失真 → 只读；
 *   - 100% 却仍有隐藏节点（异常态 / 临时状态未清）→ 同样只读，绝不误解锁。
 * 端点判定复用 zoomScale.isAtMaxZoom（按显示百分比，与按钮读数同源），
 * 不另写一套 raw 浮点容差。
 *
 * 只读期间**不是**丢掉所有 React Flow change：
 *   - `select` 只是查看态，放行（用户仍能选中节点看右栏详情）；
 *   - `dimensions` 是 xyflow 的测量结果 / 卡片 auto-size 回写，拦掉会毁掉
 *     handleBounds、连线端点和自适应尺寸；
 *   - `position` / `remove` / `add` / `replace` 才是真正改图的写操作，必须拦。
 */
import type { EdgeChange, NodeChange } from '@xyflow/react'
import { isAtMaxZoom } from './zoomScale'

export type CanvasReadOnlyReason = 'editable' | 'zoomed-out' | 'hidden-nodes'

export interface CanvasReadOnlyState {
  readOnly: boolean
  reason: CanvasReadOnlyReason
  /** 当前被 LOD / 碰撞抽稀隐藏的节点数（只读提示用） */
  hiddenNodeCount: number
  atMaxZoom: boolean
}

/** 默认（画布未挂载 / 已卸载）必须可编辑，避免加载期误锁。 */
export const CANVAS_EDITABLE_STATE: CanvasReadOnlyState = {
  readOnly: false,
  reason: 'editable',
  hiddenNodeCount: 0,
  atMaxZoom: true,
}

export function computeCanvasReadOnly(zoom: number, hiddenNodeCount: number): CanvasReadOnlyState {
  const atMaxZoom = isAtMaxZoom(zoom)
  const hidden = Number.isFinite(hiddenNodeCount) ? Math.max(0, Math.floor(hiddenNodeCount)) : 0
  const readOnly = !atMaxZoom || hidden > 0
  const reason: CanvasReadOnlyReason = !atMaxZoom
    ? 'zoomed-out'
    : hidden > 0 ? 'hidden-nodes' : 'editable'
  return { readOnly, reason, hiddenNodeCount: hidden, atMaxZoom }
}

export function isViewOnlyNodeChange(change: NodeChange): boolean {
  if (change.type === 'select') return true
  if (change.type !== 'dimensions') return false
  // 手动 resize 的 dimensions change 带 resizing:true / origin:'manual'，本质是改尺寸，
  // 只读期必须拦；xyflow 自动测量（resizing 缺省）与卡片 auto-size 回写
  // （origin:'auto-size'）只是视图态，拦掉会毁掉 handleBounds 与自适应尺寸。
  const flagged = change as NodeChange & { resizing?: boolean; origin?: string }
  return flagged.resizing !== true && flagged.origin !== 'manual'
}

export function isViewOnlyEdgeChange(change: EdgeChange): boolean {
  return change.type === 'select'
}

export function filterReadOnlyNodeChanges(changes: readonly NodeChange[]): NodeChange[] {
  return changes.filter(isViewOnlyNodeChange)
}

export function filterReadOnlyEdgeChanges(changes: readonly EdgeChange[]): EdgeChange[] {
  return changes.filter(isViewOnlyEdgeChange)
}
