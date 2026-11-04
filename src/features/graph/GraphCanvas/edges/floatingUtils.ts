import { Position, type InternalNode } from '@xyflow/react'
import {
  normalizeEdgeAnchor,
  offsetBorderPoints,
  resolveAnchorPoint,
  type AnchorRect,
  type EdgeAnchorPatch,
} from '../../../../domain/graph/edgeAnchors'
import {
  CURVE_AMPLITUDE_MAX,
  CURVE_AMPLITUDE_MIN,
  CURVE_AMPLITUDE_SCALE,
  CURVE_POSITION_MAX,
  CURVE_POSITION_MIN,
  DEFAULT_CURVE_CONTROL,
  normalizeCurveControl,
  type CurveControl,
} from '../../../../domain/graph/edgeCurve'

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
 * 曲线几何：由「曲线上的一个可拖动控制点」P 定义二次贝塞尔。
 *
 * Q(0.5) = 0.25·S + 0.5·C + 0.25·T，故令 C = 2P - (S+T)/2 时曲线严格经过 P，
 * 手柄永远落在曲线上，拖到哪曲线就经过哪。P 用相对连线的归一化坐标 {u,v} 表达：
 *   u = 沿连线方向的位置（弯曲发生在哪）、v = 垂直偏移量（弯多深、朝哪侧）。
 * 两者完全解耦，因此「弯曲位置」与「弯曲幅度」可用同一个手柄自由调整。
 * 所有系数集中在 domain/graph/edgeCurve.ts，这里不再有自造的近似常量。
 */

/** 由归一化控制点算出画布上的绝对点 P */
export function getCurveControlPoint(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  control: CurveControl
): { x: number; y: number } {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  // 法向取「朝上」：水平向右的连线，正值 v 向上弯
  const nx = dy / len
  const ny = -dx / len
  const offset = control.v * len * CURVE_AMPLITUDE_SCALE
  return {
    x: sourceX + dx * control.u + nx * offset,
    y: sourceY + dy * control.u + ny * offset,
  }
}

/** 二次贝塞尔路径；返回 [path, P.x, P.y]，P 同时是手柄位置与工具栏挂靠/避让点 */
export function getCurvedEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  control: CurveControl | null | undefined
): [string, number, number] {
  const resolved = normalizeCurveControl(control) ?? DEFAULT_CURVE_CONTROL
  const point = getCurveControlPoint(sourceX, sourceY, targetX, targetY, resolved)
  const cx = 2 * point.x - (sourceX + targetX) / 2
  const cy = 2 * point.y - (sourceY + targetY) / 2
  return [`M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`, point.x, point.y]
}

/** 由拖拽指针位置反推控制点：沿连线投影得 u、沿法向投影得 v，各自钳制 */
export function resolveCurveControlFromDrag(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  pointerX: number,
  pointerY: number
): CurveControl {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const len2 = len * len
  const nx = dy / len
  const ny = -dx / len
  const u = ((pointerX - sourceX) * dx + (pointerY - sourceY) * dy) / len2
  const offset = (pointerX - sourceX) * nx + (pointerY - sourceY) * ny
  const v = offset / (len * CURVE_AMPLITUDE_SCALE)
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  return {
    u: clamp(u, CURVE_POSITION_MIN, CURVE_POSITION_MAX),
    v: clamp(v, CURVE_AMPLITUDE_MIN, CURVE_AMPLITUDE_MAX),
  }
}
