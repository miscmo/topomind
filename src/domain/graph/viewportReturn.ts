/**
 * 「返回上一个视野」的唯一规则源（纯函数，无 DOM / 无 store / 无 IPC，可被 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-09】通过搜索 / 缩略图 / 查看同名节点跳到远处节点后，
 * 往往还得重新缩小找回之前的节点。因此提供一次性的「返回上个视野」按钮。
 *
 * 消失策略（用户要求「优雅一些」，不要常驻打扰）：
 *  1. **只记程序化跳转**：手动平移 / 滚轮缩放不进历史，由埋点入口决定；
 *  2. **每个 tab 只保留最近一次**：连续跳转覆盖上一条，不做多层栈；
 *  3. **镜头停稳才出现**：跳转动画结束后采样落点，移动距离太小的不弹；
 *  4. **超时自动消失**：TTL 到期即卸载；鼠标悬停时暂停倒计时（正在犹豫不打断）；
 *  5. **开始工作即消失**：用户一旦拖拽 / 滚轮 / 点击节点或面板，视口偏离落点就立刻淡出；
 *  6. **点击返回 / 主动关闭后立即消失**，纯运行时状态，不落盘、不进撤销历史。
 */
export const VIEWPORT_RETURN_TTL_MS = 12000
/** 与 setCenter 的 180~300ms 动画对齐，停稳后再采样落点。 */
export const VIEWPORT_RETURN_SETTLE_MS = 340
/** 跳转位移小于这个屏幕像素就不弹按钮（点了就在旁边的节点没必要提示）。 */
export const VIEWPORT_RETURN_MIN_DISTANCE_PX = 24
/** 落点漂移超过这个阈值视为「用户已经开始自己操作画布」。 */
export const VIEWPORT_RETURN_MOVE_TOLERANCE_PX = 12
/** zoom 差折算成屏幕像素的权重，让纯缩放也能触发 / 判定。 */
export const VIEWPORT_RETURN_ZOOM_DISTANCE_SCALE = 600
/** 返回时的镜头动画时长。 */
export const VIEWPORT_RETURN_ANIMATION_MS = 320

export interface ViewportSnapshot {
  x: number
  y: number
  zoom: number
}

export interface ViewportReturnEntry {
  /** 跳转前的完整视口，点返回时原样恢复 */
  from: ViewportSnapshot
  /** 跳转停稳后的落点，用于判断用户是否已经移开 */
  to: ViewportSnapshot
  /** 目标节点标题，按钮上显示「返回「XXX」」 */
  label: string
  createdAt: number
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0
}

/** React Flow 的 viewport.x/y 本身就是屏幕像素平移，无需再换算 flow 坐标。 */
export function viewportPanDistance(
  from: ViewportSnapshot,
  to: ViewportSnapshot,
): number {
  return Math.hypot(finite(to.x) - finite(from.x), finite(to.y) - finite(from.y))
}

export function viewportZoomDistance(
  from: ViewportSnapshot,
  to: ViewportSnapshot,
): number {
  return Math.abs(finite(to.zoom) - finite(from.zoom)) * VIEWPORT_RETURN_ZOOM_DISTANCE_SCALE
}

export function viewportJumpDistance(
  from: ViewportSnapshot,
  to: ViewportSnapshot,
): number {
  return Math.hypot(
    viewportPanDistance(from, to),
    viewportZoomDistance(from, to),
  )
}

/** 是否值得弹按钮：几乎没动（或只点了当前节点）就不打扰。 */
export function shouldOfferViewportReturn(
  from: ViewportSnapshot,
  to: ViewportSnapshot,
): boolean {
  return viewportJumpDistance(from, to) > VIEWPORT_RETURN_MIN_DISTANCE_PX
}

export function isViewportReturnExpired(
  entry: ViewportReturnEntry,
  now: number,
  ttl: number = VIEWPORT_RETURN_TTL_MS,
): boolean {
  return now - entry.createdAt >= ttl
}

export function viewportReturnRemainingMs(
  entry: ViewportReturnEntry,
  now: number,
  ttl: number = VIEWPORT_RETURN_TTL_MS,
): number {
  return Math.max(0, Math.min(ttl, ttl - (now - entry.createdAt)))
}

/** 用户手动把镜头拖走 / 缩放后，返回提示已经没有意义。 */
export function hasUserMovedAway(
  entry: ViewportReturnEntry,
  current: ViewportSnapshot,
  tolerance: number = VIEWPORT_RETURN_MOVE_TOLERANCE_PX,
): boolean {
  return viewportJumpDistance(entry.to, current) > tolerance
}
