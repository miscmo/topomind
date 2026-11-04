/**
 * 连线端点锚点。
 *
 * 锚点绑定在「边」上（每条边的起点端/终点端各一份），不是节点属性，
 * 因此同一个节点对不同连线可以有不同的接线位置。
 *
 * 锚点只表示「这条线从节点边框的哪个位置出发」，**不是线的实际端点**：
 *   1. 锚点恒落在节点矩形边框上，归一化 (u, v) ∈ [0,1]² 且至少一个分量为 0 或 1；
 *   2. 渲染时以锚点（或自动求出的边框交点）为基准，沿连线方向再外推一段间隙
 *      才得到真正画线的起点/终点，线与节点边框之间始终留白（见 offsetBorderPoints）。
 *
 * 坐标是相对节点矩形的比例：实际画布坐标 = 节点绝对位置 + (u × 宽, v × 高)，
 * 因此节点移动、缩放时锚点自动等比跟随。缺省 / null / 非法值一律回落自动交点，
 * 旧存档行为不变；旧存档里若存着框内点，渲染时会投影到最近的边框。
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** 锚点不允许拖出节点，最多停在边框上 */
export function clampEdgeAnchor(anchor: EdgeAnchor): EdgeAnchor {
  return { u: clamp01(anchor.u), v: clamp01(anchor.v) }
}

/** 是否贴在某条边框上（角点也算） */
export function isBorderAnchor(anchor: EdgeAnchor): boolean {
  const { u, v } = clampEdgeAnchor(anchor)
  return u <= 0 || u >= 1 || v <= 0 || v >= 1
}

/**
 * 把框内任意位置投影到「最近的边框」，沿边方向的分量保留。
 * 距离用像素而非归一化比例，避免宽高比悬殊时贴错边；
 * 已在边框上的点投影是幂等的（最小距离为 0，仍落回同一条边）。
 */
export function projectAnchorToBorder(anchor: EdgeAnchor, rect: AnchorRect): EdgeAnchor {
  const { u, v } = clampEdgeAnchor(anchor)
  if (rect.width <= 0 || rect.height <= 0) return { u, v }

  const distances: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; d: number }> = [
    { side: 'left', d: u * rect.width },
    { side: 'right', d: (1 - u) * rect.width },
    { side: 'top', d: v * rect.height },
    { side: 'bottom', d: (1 - v) * rect.height },
  ]
  let nearest = distances[0]
  for (const candidate of distances) {
    if (candidate.d < nearest.d) nearest = candidate
  }

  switch (nearest.side) {
    case 'left': return { u: 0, v }
    case 'right': return { u: 1, v }
    case 'top': return { u, v: 0 }
    case 'bottom': return { u, v: 1 }
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

/**
 * 归一化锚点 → 边框交点（画布坐标）。
 * 旧存档可能存着框内点，这里统一投影到最近边框，保证线只从边框出。
 * 矩形未测量完成时返回 undefined，由调用方回落自动交点。
 */
export function resolveAnchorPoint(rect: AnchorRect, anchor: EdgeAnchor | null | undefined) {
  if (!anchor || rect.width <= 0 || rect.height <= 0) return undefined
  const { u, v } = projectAnchorToBorder(anchor, rect)
  return { x: rect.x + u * rect.width, y: rect.y + v * rect.height }
}

/** 画布坐标 → 边框上的归一化锚点（拖动时把鼠标位置投影到最近的边） */
export function toEdgeAnchor(rect: AnchorRect, point: { x: number; y: number }): EdgeAnchor | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined
  return projectAnchorToBorder({
    u: (point.x - rect.x) / rect.width,
    v: (point.y - rect.y) / rect.height,
  }, rect)
}

/**
 * 两个边框交点 → 真正的线头：沿两点连线方向各向外推 offset px。
 *
 * 这是原来「自动连线」的既有设计，自定义锚点也一律沿用——
 * 线头不与锚点手柄重合，线与节点边框之间始终保留一段间隙。
 * 两点过近时不外推，避免线头越过彼此。
 */
export function offsetBorderPoints(
  source: { x: number; y: number },
  target: { x: number; y: number },
  offset: number = 6
) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length <= offset * 2) {
    return { sx: source.x, sy: source.y, tx: target.x, ty: target.y }
  }
  const ux = dx / length
  const uy = dy / length
  return {
    sx: source.x + ux * offset,
    sy: source.y + uy * offset,
    tx: target.x - ux * offset,
    ty: target.y - uy * offset,
  }
}
