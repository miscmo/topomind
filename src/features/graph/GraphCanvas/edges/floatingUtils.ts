import { Position, type InternalNode } from '@xyflow/react'
import {
  normalizeEdgeAnchor,
  offsetBorderPoints,
  resolveAnchorPoint,
  type AnchorRect,
  type EdgeAnchorPatch,
} from '../../../../domain/graph/edgeAnchors'

/** React Flow 内部节点的绝对矩形（含父节点偏移），锚点换算与路径计算共用 */
export function getInternalNodeRect(node: InternalNode): AnchorRect {
  const position = node.internals?.positionAbsolute ?? { x: 0, y: 0 }
  return {
    x: position.x,
    y: position.y,
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  }
}

function getRectCenter(rect: AnchorRect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

// 计算从节点中心射向目标点的射线，与该节点边框的交点
function getNodeIntersection(intersectionNode: InternalNode, targetPoint: { x: number; y: number }) {
  const intersectionNodeWidth = intersectionNode.measured?.width || 0
  const intersectionNodeHeight = intersectionNode.measured?.height || 0
  const intersectionNodePosition = intersectionNode.internals?.positionAbsolute || { x: 0, y: 0 }

  const w = Math.max(intersectionNodeWidth / 2, 1)
  const h = Math.max(intersectionNodeHeight / 2, 1)

  const x2 = intersectionNodePosition.x + w
  const y2 = intersectionNodePosition.y + h
  const x1 = targetPoint.x
  const y1 = targetPoint.y

  if (x1 === x2 && y1 === y2) {
    return { x: x2, y: y2 }
  }

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1))
  const xx3 = a * xx1
  const yy3 = a * yy1
  const x = w * (xx3 + yy3) + x2
  const y = h * (-xx3 + yy3) + y2

  return { x, y }
}

// 根据交点在节点的哪一侧，返回对应的 Position (上、下、左、右)
function getEdgePosition(rect: AnchorRect, intersectionPoint: { x: number; y: number }) {
  const nx = Math.round(rect.x)
  const ny = Math.round(rect.y)
  const px = Math.round(intersectionPoint.x)
  const py = Math.round(intersectionPoint.y)

  if (px <= nx + 1) return Position.Left
  if (px >= nx + rect.width - 1) return Position.Right
  if (py <= ny + 1) return Position.Top
  if (py >= ny + rect.height - 1) return Position.Bottom

  return Position.Top
}

/**
 * 计算一条连线的两个端点。
 *
 * 锚点只决定「这条线从节点边框的哪个位置出发」：有锚点的一端用锚点作为
 * 边框交点，没锚点的一端沿用旧的「两端中心连线求边框交点」算法；
 * 一端自定义、另一端自动时，自动端改朝对方的实际交点求交，避免方向跑偏。
 *
 * 两个边框交点随后一律沿连线方向各外推 offset(6px) 才成为真正的线头，
 * 因此线不会直接连到锚点手柄上，线与边框之间始终保留原有间隙。
 *
 * 返回：sx/sy/tx/ty = 画线的线头；sourceBorder/targetBorder = 边框交点
 * （锚点手柄贴在这里，工具栏避让也按这两个点算）。
 */
export function getEdgeParams(
  source: InternalNode,
  target: InternalNode,
  anchors: EdgeAnchorPatch = {},
  offset: number = 6
) {
  const sourceRect = getInternalNodeRect(source)
  const targetRect = getInternalNodeRect(target)
  const sourceCenter = getRectCenter(sourceRect)
  const targetCenter = getRectCenter(targetRect)
  const sourceAnchor = normalizeEdgeAnchor(anchors.sourceAnchor)
  const targetAnchor = normalizeEdgeAnchor(anchors.targetAnchor)

  let sourcePoint = resolveAnchorPoint(sourceRect, sourceAnchor) ?? getNodeIntersection(source, targetCenter)
  let targetPoint = resolveAnchorPoint(targetRect, targetAnchor) ?? getNodeIntersection(target, sourceCenter)

  if (!sourceAnchor && targetAnchor) sourcePoint = getNodeIntersection(source, targetPoint)
  if (!targetAnchor && sourceAnchor) targetPoint = getNodeIntersection(target, sourcePoint)

  // 自定义端与自动端一样，都按交点实际落在哪条边上判断出线方向
  const sourcePos = getEdgePosition(sourceRect, sourcePoint)
  const targetPos = getEdgePosition(targetRect, targetPoint)

  const { sx, sy, tx, ty } = offsetBorderPoints(sourcePoint, targetPoint, offset)

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
    sourceBorder: sourcePoint,
    targetBorder: targetPoint,
  }
}

/**
 * 曲线弯曲系数：bend ∈ [-1, 1] 决定控制点相对连线的垂直偏移。
 * 0 ≈ 直线，绝对值越大弯得越深，正负决定朝连线哪一侧弯。
 */
export const CURVE_BEND_FACTOR = 0.45
/** 曲线弧长中点（手柄抓取点）相对直线中点的偏移系数，用于把 bend 反推回拖拽位移 */
export const CURVE_MIDPOINT_RATIO = 0.75

/**
 * 计算一条三次贝塞尔曲线：两端固定在 (sx,sy)/(tx,ty)，两个控制点沿连线方向
 * 各推进 1/3、2/3，并整体沿「垂直法向」偏移 bend·len·FACTOR。这样无论两端锚点
 * 落在节点哪条边，曲线始终从边框交点平滑起笔、对称地弓起。
 *
 * 返回 [path, labelX, labelY]，label 取曲线弧长中点（≈ 直线中点 + 法向·offset·RATIO），
 * 正好是曲线弓得最高的位置——也是拖动控制柄的抓取点。
 */
export function getCurvedEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  bend: number
): [string, number, number] {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const offset = bend * len * CURVE_BEND_FACTOR

  const c1x = sourceX + dx * (1 / 3) + nx * offset
  const c1y = sourceY + dy * (1 / 3) + ny * offset
  const c2x = sourceX + dx * (2 / 3) + nx * offset
  const c2y = sourceY + dy * (2 / 3) + ny * offset

  const path = `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`
  const midX = (sourceX + targetX) / 2 + nx * offset * CURVE_MIDPOINT_RATIO
  const midY = (sourceY + targetY) / 2 + ny * offset * CURVE_MIDPOINT_RATIO
  return [path, midX, midY]
}

/**
 * 由「拖拽点相对直线中点的垂直位移」反推 curveBend，钳制到 [-1, 1]。
 * 与 getCurvedEdgePath 共用同一套 len / FACTOR / RATIO，保证手柄位置与数值一致。
 */
export function resolveCurveBendFromDrag(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  pointerX: number,
  pointerY: number
): number {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2
  const perp = (pointerX - midX) * nx + (pointerY - midY) * ny
  const bend = perp / (CURVE_MIDPOINT_RATIO * CURVE_BEND_FACTOR * len)
  return Math.min(1, Math.max(-1, bend))
}
