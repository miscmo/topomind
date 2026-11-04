/**
 * 连线端点锚点。
 *
 * 锚点绑定在「边」上（每条边的起点端/终点端各一份），不是节点属性，
 * 因此同一个节点对不同连线可以有不同的接线位置。
 *
 * 坐标是相对节点矩形的归一化比例 (u, v) ∈ [0, 1]：
 *   实际画布坐标 = 节点绝对位置 + (u × 宽, v × 高)
 * 这样节点移动、缩放时锚点都自动等比跟随，无需额外的同步逻辑。
 * 缺省 / null / 非法值一律表示「回落自动交点」，保证旧存档行为不变。
 */

export interface EdgeAnchor {
  /** 相对节点左边缘的水平比例 */
  u: number
  /** 相对节点上边缘的垂直比例 */
  v: number
}

/** 更新锚点的补丁：null 表示恢复该端的自动交点 */
export interface EdgeAnchorPatch {
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
}

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

export type EdgeAnchorSide = 'left' | 'right' | 'top' | 'bottom'

/** 锚点不允许拖出节点，最多停在边框上 */
export function clampEdgeAnchor(anchor: EdgeAnchor): EdgeAnchor {
  return {
    u: Math.min(1, Math.max(0, anchor.u)),
    v: Math.min(1, Math.max(0, anchor.v)),
  }
}

/** 存档/运行时传入的锚点统一收敛；非法值视为「无锚点」 */
export function normalizeEdgeAnchor(value: unknown): EdgeAnchor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.u !== 'number' || !Number.isFinite(candidate.u)) return undefined
  if (typeof candidate.v !== 'number' || !Number.isFinite(candidate.v)) return undefined
  return clampEdgeAnchor({ u: candidate.u, v: candidate.v })
}

/** 归一化坐标 → 画布坐标；矩形未测量完成时返回 undefined，由调用方回落自动交点 */
export function resolveAnchorPoint(rect: AnchorRect, anchor: EdgeAnchor | null | undefined) {
  if (!anchor || rect.width <= 0 || rect.height <= 0) return undefined
  const { u, v } = clampEdgeAnchor(anchor)
  return { x: rect.x + u * rect.width, y: rect.y + v * rect.height }
}

/** 画布坐标 → 归一化坐标（拖动时把鼠标位置钳制回节点框内） */
export function toEdgeAnchor(rect: AnchorRect, point: { x: number; y: number }): EdgeAnchor | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined
  return clampEdgeAnchor({
    u: (point.x - rect.x) / rect.width,
    v: (point.y - rect.y) / rect.height,
  })
}

/**
 * smoothstep 需要知道从节点哪一侧出线。
 * 自定义锚点可能落在节点内部，用「离哪条边更近」推断方向；
 * 正好在中心时按对端节点在哪一侧决定水平方向。
 */
export function getAnchorSide(
  anchor: EdgeAnchor,
  rect: AnchorRect,
  otherCenter: { x: number; y: number }
): EdgeAnchorSide {
  const { u, v } = clampEdgeAnchor(anchor)
  const dx = (u - 0.5) * rect.width
  const dy = (v - 0.5) * rect.height
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    return otherCenter.x >= rect.x + rect.width / 2 ? 'right' : 'left'
  }
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}
