/**
 * 房间落点规划（纯函数，无 IO）。
 *
 * 跨房间批量移动节点时，源房间与目标房间的坐标系互相独立：直接把 children 的
 * x/y 复制到目标房间，很可能压在目标房间已有节点上。这里只做「整批平移」——
 * 同一个 (dx, dy) 施加给所有被移动节点，因此：
 *   - 被移动节点之间的相对位置完全不变（内部连线的视觉布局不变）；
 *   - 边的 source/target 是节点 id 引用、锚点是相对比例，平移不需要改边。
 *
 * 优先保持原位（原位本来就是空白区域时零位移）；重叠时按「就近」原则向外试探
 * 一个不与任何已有节点（含留白）相交的位置，而不是粗暴地挪到全房间包围盒右侧
 * —— 后者在房间节点分布很宽时会把节点推到画布极远处，进去根本看不到。
 */

export const DEFAULT_NODE_WIDTH = 120
export const DEFAULT_NODE_HEIGHT = 52
export const PLACEMENT_GAP = 80

/** children[id] → 布局矩形；缺省坐标按 0、缺省尺寸按卡片默认值。 */
export function childRect(child) {
  const c = child && typeof child === 'object' ? child : {}
  return {
    x: Number.isFinite(c.x) ? c.x : 0,
    y: Number.isFinite(c.y) ? c.y : 0,
    w: Number.isFinite(c.width) && c.width > 0 ? c.width : DEFAULT_NODE_WIDTH,
    h: Number.isFinite(c.height) && c.height > 0 ? c.height : DEFAULT_NODE_HEIGHT,
  }
}

function overlaps(a, b, padding) {
  return a.x < b.x + b.w + padding
    && b.x < a.x + a.w + padding
    && a.y < b.y + b.h + padding
    && b.y < a.y + a.h + padding
}

/**
 * @param {Array<{x:number,y:number,w:number,h:number}>} movingRects 被移动节点矩形
 * @param {Array<{x:number,y:number,w:number,h:number}>} occupiedRects 目标房间已有节点矩形
 * @returns {{dx:number, dy:number, relocated:boolean}}
 */
export function planRoomPlacement(movingRects, occupiedRects, gap = PLACEMENT_GAP) {
  const moving = Array.isArray(movingRects) ? movingRects.filter(Boolean) : []
  const occupied = Array.isArray(occupiedRects) ? occupiedRects.filter(Boolean) : []
  const noMove = { dx: 0, dy: 0, relocated: false }
  if (moving.length === 0 || occupied.length === 0) return noMove

  const pad = Math.max(8, Math.round(gap / 2))
  let minX = Infinity
  let minY = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity
  let occMinX = Infinity
  let occMinY = Infinity
  let occMaxRight = -Infinity
  let occMaxBottom = -Infinity
  moving.forEach((r) => {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxRight = Math.max(maxRight, r.x + r.w)
    maxBottom = Math.max(maxBottom, r.y + r.h)
  })
  occupied.forEach((r) => {
    occMinX = Math.min(occMinX, r.x)
    occMinY = Math.min(occMinY, r.y)
    occMaxRight = Math.max(occMaxRight, r.x + r.w)
    occMaxBottom = Math.max(occMaxBottom, r.y + r.h)
  })
  const batchW = maxRight - minX
  const batchH = maxBottom - minY
  const stepX = Math.max(1, batchW + gap)
  const stepY = Math.max(1, batchH + gap)

  const fits = (dx, dy) => {
    const box = { x: minX + dx, y: minY + dy, w: batchW, h: batchH }
    // 与已有节点整体包围盒完全错开 → 必然不相交，跳过 O(N*M) 逐矩形判断。
    if (box.x + box.w + pad <= occMinX || occMaxRight + pad <= box.x
      || box.y + box.h + pad <= occMinY || occMaxBottom + pad <= box.y) return true
    return !moving.some((m) => occupied.some((o) => overlaps(
      { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h }, o, pad,
    )))
  }

  if (fits(0, 0)) return noMove

  // 按环向外试探：优先右侧 / 下方（正方向），再考虑左 / 上，保证落点尽量靠近原位。
  for (let ring = 1; ring <= 24; ring += 1) {
    const offsets = []
    for (let gx = -ring; gx <= ring; gx += 1) {
      for (let gy = -ring; gy <= ring; gy += 1) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) !== ring) continue
        offsets.push([gx, gy])
      }
    }
    const penalty = ([gx, gy]) => (gx < 0 ? 2 : 0) + (gy < 0 ? 1 : 0)
    offsets.sort((a, b) => penalty(a) - penalty(b)
      || (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1]))
      || Math.abs(a[1]) - Math.abs(b[1]))
    for (const [gx, gy] of offsets) {
      const dx = gx * stepX
      const dy = gy * stepY
      if (fits(dx, dy)) return { dx, dy, relocated: true }
    }
  }

  // 兜底：整体包围盒右侧，新批次左边界恒大于所有已有节点右边界，必然不相交。
  return { dx: Math.round(occMaxRight + gap - minX), dy: 0, relocated: true }
}
