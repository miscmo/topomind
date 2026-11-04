/**
 * 连线曲线的数据模型与归一化。
 *
 * 设计要点（取代早期的「单曲率系数 curveBend」）：
 * - 曲线由**曲线上的一个可拖动控制点**定义，而不是一个抽象的弯曲系数。
 * - 控制点用相对两端连线的归一化坐标 {u, v} 存储，节点移动 / 缩放时曲线等比跟随，
 *   不需要重新计算绝对坐标。
 *   · u = 沿连线方向的位置（弯曲发生在哪），钳制到 [0.25, 0.75] 避免端点回勾
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

/**
 * 弯曲位置允许范围（简单方案：收紧区间，不改贝塞尔阶数）。
 *
 * 二次贝塞尔由 P 反推 C = 2P - (S+T)/2，C 沿连线方向的投影 = L·(2u - 0.5)。
 * 当 u < 0.25 时 C 被推到起点外侧 → 起点切线反向、曲线 x 先退后前进（回勾，
 * 视觉上像从节点里钻出来）；u > 0.75 同理发生在终点一侧。
 * u ∈ [0.25, 0.75] 恰好保证 C 的投影落在两端之间，此时沿连线方向单调、
 * 端点切线不反向。旧存档里越界的 u 由 normalizeCurveControl 平滑钳到边界。
 */
export const CURVE_POSITION_MIN = 0.25
export const CURVE_POSITION_MAX = 0.75
/** 弯曲幅度范围 */
export const CURVE_AMPLITUDE_MIN = -1
export const CURVE_AMPLITUDE_MAX = 1
/** v=1 时的像素偏移 = 连线长度 × 该系数 */
export const CURVE_AMPLITUDE_SCALE = 0.5

/** 缺省控制点：位于连线正中、零偏移 → 曲线退化为直线 */
export const DEFAULT_CURVE_CONTROL: CurveControl = { u: 0.5, v: 0 }

/**
 * 从其它线型切到「曲线」且没有自定义控制点时使用的初始弧度。
 * 不能直接沿用 DEFAULT_CURVE_CONTROL（v=0）：那会让用户点了「曲线」却得到一条
 * 看不出变化的直线；给一个温和的默认弧度，之后仍可用手柄 / 滑杆 / 复位自由调整。
 */
export const CURVE_MODE_DEFAULT_CONTROL: CurveControl = { u: 0.5, v: 0.25 }

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

/**
 * 从其它线型切到「曲线」、且当前没有自定义曲线形态时，返回应注入的可见默认弧度；
 * 其余情况返回 null（保持现状）。
 *
 * 单独抽成纯函数是为了让回归能锁住这条交互规则：早期版本切到曲线仍是直线
 * （默认控制点 v=0），用户得再去拖手柄才看得到变化。
 */
export function seedCurveControlOnModeSwitch(
  nextMode: unknown,
  currentMode: unknown,
  currentControl: CurveControl | null | undefined
): CurveControl | null {
  if (nextMode !== 'curve' || currentMode === 'curve') return null
  return hasCustomCurve(normalizeCurveControl(currentControl))
    ? null
    : { ...CURVE_MODE_DEFAULT_CONTROL }
}

/**
 * 曲线滑杆的草稿与已提交值是否有实质差异：点击轨道 / 拖回原值时不该白写一次库。
 * 滑杆每帧只改草稿，pointerup 才据此判断是否提交。
 */
export function hasCurveDraftChange(committed: CurveControl, draft: CurveControl): boolean {
  return Math.abs(draft.u - committed.u) > 1e-6 || Math.abs(draft.v - committed.v) > 1e-6
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
