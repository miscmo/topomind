import { Position, type InternalNode } from '@xyflow/react'

// 计算从 source 中心到 target 中心的射线，与 source 边界的交点
function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode) {
  const intersectionNodeWidth = intersectionNode.measured?.width || 0
  const intersectionNodeHeight = intersectionNode.measured?.height || 0
  const intersectionNodePosition = intersectionNode.internals?.positionAbsolute || { x: 0, y: 0 }

  const targetPosition = targetNode.internals?.positionAbsolute || { x: 0, y: 0 }

  const w = Math.max(intersectionNodeWidth / 2, 1)
  const h = Math.max(intersectionNodeHeight / 2, 1)

  const x2 = intersectionNodePosition.x + w
  const y2 = intersectionNodePosition.y + h
  const x1 = targetPosition.x + (targetNode.measured?.width || 0) / 2
  const y1 = targetPosition.y + (targetNode.measured?.height || 0) / 2

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
function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }) {
  const nx = Math.round(node.internals?.positionAbsolute?.x || 0)
  const ny = Math.round(node.internals?.positionAbsolute?.y || 0)
  const px = Math.round(intersectionPoint.x)
  const py = Math.round(intersectionPoint.y)

  if (px <= nx + 1) {
    return Position.Left
  }
  if (px >= nx + (node.measured?.width || 0) - 1) {
    return Position.Right
  }
  if (py <= ny + 1) {
    return Position.Top
  }
  if (py >= ny + (node.measured?.height || 0) - 1) {
    return Position.Bottom
  }

  return Position.Top
}

export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sourceIntersectionPoint = getNodeIntersection(source, target)
  const targetIntersectionPoint = getNodeIntersection(target, source)

  const sourcePos = getEdgePosition(source, sourceIntersectionPoint)
  const targetPos = getEdgePosition(target, targetIntersectionPoint)

  return {
    sx: sourceIntersectionPoint.x,
    sy: sourceIntersectionPoint.y,
    tx: targetIntersectionPoint.x,
    ty: targetIntersectionPoint.y,
    sourcePos,
    targetPos,
  }
}
