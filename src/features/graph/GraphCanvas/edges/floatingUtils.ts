import { Position, type InternalNode } from '@xyflow/react'
import {
  getAnchorSide,
  normalizeEdgeAnchor,
  resolveAnchorPoint,
  type AnchorRect,
  type EdgeAnchorPatch,
  type EdgeAnchorSide,
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

export function anchorSideToPosition(side: EdgeAnchorSide): Position {
  switch (side) {
    case 'left': return Position.Left
    case 'right': return Position.Right
    case 'top': return Position.Top
    case 'bottom': return Position.Bottom
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
 * 缺省（老存档 / 未拖动过）时完全沿用旧算法：以两端中心连线为射线求边框交点，
 * 再沿方向各外推 offset px。任一端设置了锚点，该端就直接落在
 * 节点绝对位置 + (u × 宽, v × 高) 上，且不再做 offset 外推——手柄与线端点严格重合。
 * 另一端若仍是自动，则改朝这一端的实际锚点求交点，避免方向仍指向节点中心。
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

  const sourcePos = sourceAnchor
    ? anchorSideToPosition(getAnchorSide(sourceAnchor, sourceRect, targetCenter))
    : getEdgePosition(sourceRect, sourcePoint)
  const targetPos = targetAnchor
    ? anchorSideToPosition(getAnchorSide(targetAnchor, targetRect, sourceCenter))
    : getEdgePosition(targetRect, targetPoint)

  const dx = targetPoint.x - sourcePoint.x
  const dy = targetPoint.y - sourcePoint.y
  const length = Math.sqrt(dx * dx + dy * dy)

  let sx = sourcePoint.x
  let sy = sourcePoint.y
  let tx = targetPoint.x
  let ty = targetPoint.y

  if (length > offset * 2) {
    const ux = dx / length
    const uy = dy / length
    if (!sourceAnchor) {
      sx += ux * offset
      sy += uy * offset
    }
    if (!targetAnchor) {
      tx -= ux * offset
      ty -= uy * offset
    }
  }

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  }
}
