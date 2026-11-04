/**
 * 连线曲线的数据模型与归一化。
 *
 * 设计要点（取代早期的「单曲率系数 curveBend」）：
 * - 曲线由**曲线上的一个可拖动控制点**定义，而不是一个抽象的弯曲系数。
 * - 控制点用相对两端连线的归一化坐标 {u, v} 存储，节点移动 / 缩放时曲线等比跟随，
 *   不需要重新计算绝对坐标。
 *   · u = 沿连线方向的位置（弯曲发生在哪），钳制到 [0.15, 0.85] 避免贴到端点
 *   · v = 垂直于连线的偏移量（弯多深、朝哪侧弯），归一化到连线长度
 * - 渲染用二次贝塞尔：由控制点 P 反推贝塞尔控制点 C = 2P - (S+T)/2，
 *   使得 Q(0.5) 恒等于 P —— 手柄严格落在曲线上，拖到哪曲线就经过哪。
 *   这套几何不含任何近似系数，位置与幅度完全解耦。
 */

/** 曲线上的可拖动控制点（归一化坐标，随节点等比缩放） */
export interface CurveControl {
  /** 沿连线方向的位置，[0,1]；0=起点、1=终点 */
  u: number
  /** 垂直弯曲幅度，[-1,1]；正值朝连线法向弯、负值反向 */
  v: number
}

/** 弯曲位置允许范围：太靠近端点会让曲线在起点/终点打结 */
export const CURVE_POSITION_MIN = 0.15
export const CURVE_POSITION_MAX = 0.85
/** 弯曲幅度范围 */
export const CURVE_AMPLITUDE_MIN = -1
export const CURVE_AMPLITUDE_MAX = 1
/** v=1 时的像素偏移 = 连线长度 × 该系数 */
export const CURVE_AMPLITUDE_SCALE = 0.5

/** 缺省控制点：位于连线正中、零偏移 → 曲线退化为直线 */
export const DEFAULT_CURVE_CONTROL: CurveControl = { u: 0.5, v: 0 }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 归一化曲线控制点：非法 / 缺省返回 null（= 使用缺省直线）。
 * `legacyBend` 用于兼容早期版本的 curveBend 存档（该版本实际未落盘，仅作保险）：
 * 旧系数换算出的峰值位移约等于 0.45 × 0.75 = 0.3375 倍线长，新系数是 0.5 × v，
 * 因此 v ≈ bend × 0.675。
 */
export function normalizeCurveControl(value: unknown, legacyBend?: unknown): CurveControl | null {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  if (raw && isFiniteNumber(raw.u) && isFiniteNumber(raw.v)) {
    return {
      u: clamp(raw.u, CURVE_POSITION_MIN, CURVE_POSITION_MAX),
      v: clamp(raw.v, CURVE_AMPLITUDE_MIN, CURVE_AMPLITUDE_MAX),
    }
  }
  if (isFiniteNumber(legacyBend)) {
    return { u: DEFAULT_CURVE_CONTROL.u, v: clamp(legacyBend * 0.675, CURVE_AMPLITUDE_MIN, CURVE_AMPLITUDE_MAX) }
  }
  return null
}

/** 控制点是否偏离缺省直线（决定工具栏「复位弯曲」是否出现） */
export function hasCustomCurve(control: CurveControl | null | undefined): boolean {
  if (!control) return false
  return Math.abs(control.u - DEFAULT_CURVE_CONTROL.u) > 1e-6
    || Math.abs(control.v - DEFAULT_CURVE_CONTROL.v) > 1e-6
}

/** 两个控制点是否等价（用于变化检测） */
export function sameCurveControl(
  a: CurveControl | null | undefined,
  b: CurveControl | null | undefined
): boolean {
  const left = normalizeCurveControl(a)
  const right = normalizeCurveControl(b)
  if (!left || !right) return left === right
  return left.u === right.u && left.v === right.v
}
