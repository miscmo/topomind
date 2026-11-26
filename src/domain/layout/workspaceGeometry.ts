/**
 * 三边栏水平互斥的几何真源（纯函数，不依赖 DOM / React / store）。
 *
 * 【2026-11-25 布局改造】导航栏、左侧栏、右侧栏不再靠 z-index 互相遮挡，而是同一层
 * 上的水平区间：导航栏 [0, R)、左侧栏 [R, B)、右栏 [W - width, W)，且右栏左边缘 ≥ B。
 * 画布仍是 `absolute inset-0 isolate`，宽度与 React Flow viewport 恒定不变。
 *
 * 唯一派生入口 computeGeometry() 把所有 clamp 收在一处：
 *   - `desired` 是用户持久化偏好（右栏按知识库分桶、左栏全局一份），只有用户主动
 *     拖拽 / 双击复位时才写入；
 *   - `effective` 是本次渲染真正显示的宽度，任何布局事件（左栏开合、rail 显隐、
 *     窗口 resize、切知识库、最大化）都只重算它，**绝不回写 desired**。
 *     因此左栏收起或窗口放大后，右栏会自动恢复到用户原本拖好的宽度。
 *
 * 主契约：右栏可拖到的最大宽度 = C = W − B（左栏展开时停在左栏边，折叠时停在导航栏边）；
 * 最大化即铺满 B 右侧的整个可用区。只有窄窗口（C 连「右栏下限 + 画布留白」都放不下）
 * 才强制保留 CANVAS_MIN_VISIBLE，并优先压缩左栏上限，保证还有画布可点。
 */

/** 与 tokens.css 的 --nav-rail-width 保持一致；几何层用常量，避免读 CSS 变量产生异步。 */
export const NAV_RAIL_WIDTH = 48
/** 右栏偏好下限（与 rightPanelStore 的 floor 一致）。 */
export const RIGHT_WIDTH_FLOOR = 280
/** 窄窗口下右栏允许降到的绝对下限。 */
export const RIGHT_ABSOLUTE_MIN = 220
/** 右栏下限的比例部分（沿用旧的 20% 规则）。 */
export const RIGHT_MIN_RATIO = 0.2
/** 左栏拖动下限 / 上限 / 默认值（四页完全共用一个宽度，切页不跳变）。 */
export const LEFT_WIDTH_FLOOR = 240
export const LEFT_WIDTH_CEILING = 560
export const LEFT_DEFAULT_WIDTH = 280
/** 窄窗口下必须保留的可见画布宽度：右栏折叠入口仍要能点到画布。 */
export const CANVAS_MIN_VISIBLE = 160

export interface GeometryInput {
  /** #app-layout 的实测宽度，绝不是 window.innerWidth：多个知识库标签页各有自己的容器。 */
  viewportWidth: number
  railVisible: boolean
  leftOpen: boolean
  leftDesiredWidth: number
  rightDesiredWidth: number
  rightCollapsed: boolean
  maximized: boolean
}

export interface WorkspaceGeometry {
  viewportWidth: number
  /** R：导航栏占用宽度 */
  railWidth: number
  /** L：左栏展开时的实际宽度（折叠时为 0） */
  leftWidth: number
  leftMin: number
  leftMax: number
  /** B = R + L：唯一「左侧不可侵犯边界」 */
  boundary: number
  /** C = W − B：右栏可用区间 */
  available: number
  rightMin: number
  rightMax: number
  /** 右栏实际宽度（折叠时为 0） */
  rightWidth: number
  /** 右栏左边缘，恒 ≥ boundary */
  rightLeft: number
  /** 右栏左侧仍可见的画布宽度 */
  canvasVisible: number
  /** 窄窗口保护是否生效，供手柄提示文案使用 */
  smallViewport: boolean
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** 调用方保证 lo ≤ hi（左/右栏的下限都先与上限取过 min）。 */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

export function computeGeometry(input: GeometryInput): WorkspaceGeometry {
  const viewportWidth = Math.max(0, Math.round(finite(input.viewportWidth, 0)))
  const railWidth = input.railVisible ? NAV_RAIL_WIDTH : 0

  // 左栏上限：先给导航栏、右栏绝对下限和一小段画布留位，剩下的才允许左栏占用。
  const roomForDocks = Math.max(0, viewportWidth - railWidth - CANVAS_MIN_VISIBLE)
  const leftMax = Math.max(0, Math.min(LEFT_WIDTH_CEILING, roomForDocks - RIGHT_ABSOLUTE_MIN))
  const leftMin = Math.min(LEFT_WIDTH_FLOOR, leftMax)
  const leftWidth = input.leftOpen
    ? clamp(Math.round(finite(input.leftDesiredWidth, LEFT_DEFAULT_WIDTH)), leftMin, leftMax)
    : 0

  const boundary = railWidth + leftWidth
  const available = Math.max(0, viewportWidth - boundary)

  // 常规窗口严格按主契约：右栏最大宽度就是 C（到左侧栏边 / 导航栏边）。
  // 只有 C 连「偏好下限 + 画布留白」都不够时才启用窄窗口保护。
  const smallViewport = available < RIGHT_WIDTH_FLOOR + CANVAS_MIN_VISIBLE
  const rightMax = smallViewport
    ? Math.max(0, available - CANVAS_MIN_VISIBLE)
    : available
  const rightMinRaw = smallViewport
    ? RIGHT_ABSOLUTE_MIN
    : Math.max(RIGHT_WIDTH_FLOOR, Math.round(viewportWidth * RIGHT_MIN_RATIO))
  const rightMin = Math.min(rightMinRaw, rightMax)

  const rightWidth = input.rightCollapsed
    ? 0
    : input.maximized
      ? rightMax
      : clamp(Math.round(finite(input.rightDesiredWidth, RIGHT_WIDTH_FLOOR)), rightMin, rightMax)
  const rightLeft = viewportWidth - rightWidth

  return {
    viewportWidth,
    railWidth,
    leftWidth,
    leftMin,
    leftMax,
    boundary,
    available,
    rightMin,
    rightMax,
    rightWidth,
    rightLeft,
    canvasVisible: Math.max(0, rightLeft - boundary),
    smallViewport,
  }
}
