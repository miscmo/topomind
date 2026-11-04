/**
 * 连线快捷工具栏的避让定位。
 *
 * 工具栏挂在 EdgeLabelRenderer 里，坐标系就是 flow 坐标（viewport 的 scale 只做视觉缩放），
 * 因此元素 offsetWidth/offsetHeight 读到的布局尺寸直接就是 flow 单位，无需再换算 zoom。
 *
 * 需要避让的原因：工具栏默认压在连线中点上方，当两个节点挨得近（尤其上下排列或短斜线）时，
 * 会正好盖住端点处的锚点手柄，导致手柄点不到、锚点调不了。
 */

export interface EdgeToolbarPoint {
  x: number
  y: number
}

export interface EdgeToolbarPlacementInput {
  /** 基准点（flow 坐标），通常是连线的 label 中点 */
  origin: EdgeToolbarPoint
  /** 两端锚点的实际位置（flow 坐标） */
  anchors: EdgeToolbarPoint[]
  /** 工具栏布局尺寸（flow 单位） */
  width: number
  height: number
}

export interface EdgeToolbarPlacement {
  x: number
  y: number
}

/** 工具栏与端点手柄之间保留的间隙 */
const SAFE_GAP = 14
/** 端点手柄的可命中半径（16px 按钮的一半 + 4px 余量） */
const HANDLE_RADIUS = 12
/** 一次避让不够时，再往外让出的距离 */
const EXTRA_SHIFT = 28
/** 手柄重叠的权重远高于其它代价，保证「不挡手柄」永远是第一优先级 */
const HANDLE_WEIGHT = 1000

interface PlacementBox {
  x: number
  y: number
  width: number
  height: number
}

function intersectArea(box: PlacementBox, anchor: EdgeToolbarPoint, radius: number): number {
  const overlapX =
    Math.min(box.x + box.width / 2, anchor.x + radius)
    - Math.max(box.x - box.width / 2, anchor.x - radius)
  const overlapY =
    Math.min(box.y + box.height / 2, anchor.y + radius)
    - Math.max(box.y - box.height / 2, anchor.y - radius)
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0
}

/**
 * 依次尝试「上 / 下 / 左 / 右」，再各向外让一档，取第一个完全不压手柄的位置；
 * 四个方向都躲不开时取重叠面积最小的那个（保证结果稳定，不会来回跳）。
 */
export function computeEdgeToolbarPlacement({
  origin,
  anchors,
  width,
  height,
}: EdgeToolbarPlacementInput): EdgeToolbarPlacement {
  const localAnchors = anchors.map((anchor) => ({
    x: anchor.x - origin.x,
    y: anchor.y - origin.y,
  }))

  const candidates: EdgeToolbarPlacement[] = []
  for (const distance of [SAFE_GAP, SAFE_GAP + EXTRA_SHIFT]) {
    candidates.push(
      { x: 0, y: -(height / 2 + distance) },
      { x: 0, y: height / 2 + distance },
      { x: -(width / 2 + distance), y: 0 },
      { x: width / 2 + distance, y: 0 },
    )
  }

  let best = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const box: PlacementBox = { x: candidate.x, y: candidate.y, width, height }
    let score = 0
    for (const anchor of localAnchors) {
      score += intersectArea(box, anchor, HANDLE_RADIUS) * HANDLE_WEIGHT
    }
    if (score <= 0) return candidate
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}
