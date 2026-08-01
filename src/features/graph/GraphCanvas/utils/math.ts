import type { Node } from '@xyflow/react'

export function getNodeRect(node: Node) {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.initialWidth ?? node.measured?.width ?? 120,
    height: node.height ?? node.initialHeight ?? node.measured?.height ?? 52,
  }
}

export function getRectCenter(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}

export interface RectSpatialItem {
  id: string
  rect: { x: number; y: number; width: number; height: number }
}

export function buildRectSpatialIndex(items: RectSpatialItem[], cellSize: number) {
  const cells = new Map<string, RectSpatialItem[]>()
  for (const item of items) {
    const minCellX = Math.floor(item.rect.x / cellSize)
    const maxCellX = Math.floor((item.rect.x + item.rect.width) / cellSize)
    const minCellY = Math.floor(item.rect.y / cellSize)
    const maxCellY = Math.floor((item.rect.y + item.rect.height) / cellSize)
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = `${cellX}:${cellY}`
        const cell = cells.get(key)
        if (cell) cell.push(item)
        else cells.set(key, [item])
      }
    }
  }
  return { cellSize, cells }
}

export function queryRectSpatialIndex(
  index: ReturnType<typeof buildRectSpatialIndex>,
  point: { x: number; y: number },
  radius: number
) {
  const minCellX = Math.floor((point.x - radius) / index.cellSize)
  const maxCellX = Math.floor((point.x + radius) / index.cellSize)
  const minCellY = Math.floor((point.y - radius) / index.cellSize)
  const maxCellY = Math.floor((point.y + radius) / index.cellSize)
  const candidates = new Map<string, RectSpatialItem>()
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (const item of index.cells.get(`${cellX}:${cellY}`) ?? []) candidates.set(item.id, item)
    }
  }
  return candidates.values()
}

export function distanceToRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

function getClosestPointOnRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  }
}

export function getRectIntersectionPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const intersections: Array<{ x: number; y: number; t: number }> = []
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  if (dx !== 0) {
    for (const x of [rect.x, right]) {
      const t = (x - from.x) / dx
      const y = from.y + t * dy
      if (t >= 0 && t <= 1 && y >= rect.y && y <= bottom) {
        intersections.push({ x, y, t })
      }
    }
  }

  if (dy !== 0) {
    for (const y of [rect.y, bottom]) {
      const t = (y - from.y) / dy
      const x = from.x + t * dx
      if (t >= 0 && t <= 1 && x >= rect.x && x <= right) {
        intersections.push({ x, y, t })
      }
    }
  }

  const intersection = intersections.sort((a, b) => b.t - a.t)[0]
  return intersection ?? getClosestPointOnRect(to, rect)
}
