import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node, NodeChange } from '@xyflow/react'
import { useGraphUiStore } from '../../../stores/graphUiStore'

/**
 * 智能参考线 / 吸附。
 *
 * 设计口径（对齐飞书「动态辅助线」与 Figma 的吸附行为）：
 * - 所有距离常量都是**屏幕像素**，进算法前除以当前 zoom 换成画布单位；
 *   ZOOM_REFERENCE=0.65，直接用画布常量会让吸附窗口只有 5.2px 且随镜头漂移。
 * - 吸附有「进入 / 释放」两个阈值（迟滞），吸住后不会在边界来回抖。
 * - 候选只取 LOD 可见、且落在拖动对象附近的节点；不再跟全图 / 视口外节点对齐。
 * - 只有「中心对齐 / 同侧边对齐」是有效语义，中心对齐优先；
 *   「左边缘贴到别人右边缘」属于间距语义，不再冒充对齐线（这是旧版最吵的来源）。
 * - 拖动结束帧必须用吸附结果覆盖 React Flow 派发的原始位置，否则松手即回弹。
 *   @xyflow/react v12 的 updateNodePositions(dragItems, false) 会带 position，
 *   且那个 position 来自 XYDrag 内部的 dragItem（从不知道吸附这回事）。
 */
const SNAP_ENTER_SCREEN_PX = 8
const SNAP_RELEASE_SCREEN_PX = 14
const NEARBY_SCREEN_PX = 260
const MAX_GUIDE_SCREEN_PX = 420
const CENTER_PRIORITY_SCREEN_PX = 1.5
const MIN_ZOOM = 0.01

/** 空数组共享引用：setGuideLines 靠同引用让 React bail out，避免每帧重渲染画布。 */
const EMPTY_GUIDE_LINES: GuideLine[] = []

export type GuideKind = 'center' | 'edge'
export type GuideLine = {
  id: string
  type: 'vertical' | 'horizontal'
  kind: GuideKind
  position: number
  start: number
  end: number
}

type Rect = {
  left: number
  top: number
  right: number
  bottom: number
  centerX: number
  centerY: number
  width: number
  height: number
}

type GuideIndex = Map<number, Set<string>>

type NodeMeta = {
  byId: Map<string, { node: Node; rect: Rect }>
  xIndex: GuideIndex
  yIndex: GuideIndex
  widthIndex: GuideIndex
  heightIndex: GuideIndex
  bounds: { left: number; top: number; right: number; bottom: number }
  threshold: number
}

type ActiveSnap = { key: string }
type LastSnap = {
  positions: Map<string, { x: number; y: number }>
  dimensions: Map<string, { width: number; height: number }>
}

export interface UseSmartGuidesOptions {
  /** 当前 raw zoom（画布变换系数），用于把屏幕像素阈值换成画布单位。 */
  getZoom: () => number
  /** LOD 派生后真正交给 React Flow 的节点；null 表示还没准备好，退回全量。 */
  getVisibleNodes: () => Node[] | null
}

type PositionChange = Extract<NodeChange, { type: 'position' }>
type DimensionChange = Extract<NodeChange, { type: 'dimensions' }>

function getZoomSafe(getZoom: () => number) {
  const zoom = getZoom()
  return Number.isFinite(zoom) && zoom > MIN_ZOOM ? zoom : MIN_ZOOM
}

/** 尺寸口径与 React Flow 的 getNodeDimensions 一致：measured 优先，避免 auto-size / 折叠态算错边缘。 */
function readSize(node: Node) {
  const width = node.measured?.width ?? node.width ?? node.initialWidth
  const height = node.measured?.height ?? node.height ?? node.initialHeight
  return {
    width: typeof width === 'number' && width > 0 ? width : 120,
    height: typeof height === 'number' && height > 0 ? height : 52,
  }
}

function readRect(
  node: Node,
  pos?: { x?: number; y?: number },
  dim?: { width?: number; height?: number },
): Rect {
  const x = pos?.x ?? node.position.x
  const y = pos?.y ?? node.position.y
  const size = readSize(node)
  const width = dim?.width ?? size.width
  const height = dim?.height ?? size.height
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    width,
    height,
  }
}

function addToGuideIndex(index: GuideIndex, value: number, nodeId: string, bucketSize: number) {
  const bucket = Math.floor(value / bucketSize)
  const ids = index.get(bucket)
  if (ids) ids.add(nodeId)
  else index.set(bucket, new Set([nodeId]))
}

function collectNearbyIds(
  index: GuideIndex,
  value: number,
  range: number,
  bucketSize: number,
  target: Set<string>,
) {
  const start = Math.floor((value - range) / bucketSize)
  const end = Math.floor((value + range) / bucketSize)
  for (let bucket = start; bucket <= end; bucket += 1) {
    for (const nodeId of index.get(bucket) ?? []) target.add(nodeId)
  }
}

/** 候选集 = LOD 可见 ∩ 拖动对象附近（避免与视口外 / 远景节点对齐，也避免跨屏长线）。 */
function buildNodeMeta(nodes: Node[], focus: Rect, threshold: number, zoom: number): NodeMeta {
  const byId = new Map<string, { node: Node; rect: Rect }>()
  const xIndex: GuideIndex = new Map()
  const yIndex: GuideIndex = new Map()
  const widthIndex: GuideIndex = new Map()
  const heightIndex: GuideIndex = new Map()
  const bucketSize = Math.max(1, threshold * 2)
  const margin = (NEARBY_SCREEN_PX * 2) / zoom
  const bounds = {
    left: focus.left - margin,
    top: focus.top - margin,
    right: focus.right + margin,
    bottom: focus.bottom + margin,
  }
  for (const node of nodes) {
    if (node.hidden) continue
    const rect = readRect(node)
    if (
      rect.right < bounds.left || rect.left > bounds.right
      || rect.bottom < bounds.top || rect.top > bounds.bottom
    ) continue
    byId.set(node.id, { node, rect })
    for (const value of [rect.left, rect.centerX, rect.right]) {
      addToGuideIndex(xIndex, value, node.id, bucketSize)
    }
    for (const value of [rect.top, rect.centerY, rect.bottom]) {
      addToGuideIndex(yIndex, value, node.id, bucketSize)
    }
    addToGuideIndex(widthIndex, rect.width, node.id, bucketSize)
    addToGuideIndex(heightIndex, rect.height, node.id, bucketSize)
  }
  return { byId, xIndex, yIndex, widthIndex, heightIndex, bounds, threshold }
}

function guideLinesEqual(a: GuideLine[], b: GuideLine[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id || x.kind !== y.kind || x.position !== y.position
      || x.start !== y.start || x.end !== y.end
    ) return false
  }
  return true
}

/** 参考线只覆盖相关对象，并限制在拖动对象附近，不再一条线拉穿整屏。 */
function clampSpan(
  dragStart: number,
  dragEnd: number,
  otherStart: number,
  otherEnd: number,
  maxLength: number,
) {
  let start = Math.min(dragStart, otherStart)
  let end = Math.max(dragEnd, otherEnd)
  const center = (dragStart + dragEnd) / 2
  start = Math.max(start, center - maxLength / 2)
  end = Math.min(end, center + maxLength / 2)
  if (end <= start) end = start + 1
  return { start, end }
}

type AlignPoint = 'left' | 'right' | 'center' | 'top' | 'bottom'
type AxisPoint = {
  dragVal: number
  targetVal: number
  align: AlignPoint
  kind: GuideKind
}
type AxisCandidate = {
  key: string
  diff: number
  score: number
  offset: number
  targetVal: number
  kind: GuideKind
  align: AlignPoint
  other: Rect
}
type AxisSnap = {
  offset: number
  guide: GuideLine
  key: string
}

function offsetFor(align: AlignPoint, dragRect: Rect, targetVal: number, vertical: boolean) {
  if (align === 'left') return targetVal - dragRect.left
  if (align === 'top') return targetVal - dragRect.top
  if (align === 'right') return targetVal - dragRect.right
  if (align === 'bottom') return targetVal - dragRect.bottom
  return targetVal - (vertical ? dragRect.centerX : dragRect.centerY)
}

/**
 * 单轴吸附：先按「中心 > 同侧边」打分挑最优，再用迟滞决定是否沿用上一帧的目标。
 * 只保留对齐语义，贴边（left ↔ other.right）不参与 —— 那是间距，不是对齐。
 */
function computeAxisSnap(params: {
  axis: 'x' | 'y'
  dragRect: Rect
  pointsByNode: Array<{ other: Rect; points: AxisPoint[] }>
  enterThreshold: number
  releaseThreshold: number
  /** 中心对齐相对边对齐的优先级加成（画布单位）。 */
  priority: number
  active: ActiveSnap | null
  maxLength: number
}): { snap: AxisSnap | null; active: ActiveSnap | null } {
  const { axis, dragRect, pointsByNode, enterThreshold, releaseThreshold, priority, active, maxLength } = params
  const vertical = axis === 'x'
  let best: AxisCandidate | null = null
  let sticky: AxisCandidate | null = null

  for (const { other, points } of pointsByNode) {
    for (const point of points) {
      const diff = Math.abs(point.dragVal - point.targetVal)
      if (diff > releaseThreshold) continue
      const key = `${axis}:${point.align}:${point.targetVal.toFixed(2)}`
      const candidate: AxisCandidate = {
        key,
        diff,
        score: diff + (point.kind === 'edge' ? priority : 0),
        offset: offsetFor(point.align, dragRect, point.targetVal, vertical),
        targetVal: point.targetVal,
        kind: point.kind,
        align: point.align,
        other,
      }
      if (active?.key === key) sticky = candidate
      if (diff <= enterThreshold && (!best || candidate.score < best.score)) best = candidate
    }
  }

  const chosen = sticky ?? best
  if (!chosen) return { snap: null, active: null }

  const span = vertical
    ? clampSpan(dragRect.top, dragRect.bottom, chosen.other.top, chosen.other.bottom, maxLength)
    : clampSpan(dragRect.left, dragRect.right, chosen.other.left, chosen.other.right, maxLength)

  return {
    snap: {
      offset: chosen.offset,
      key: chosen.key,
      guide: {
        id: `${axis}:${chosen.kind}:${chosen.targetVal.toFixed(2)}`,
        type: vertical ? 'vertical' : 'horizontal',
        kind: chosen.kind,
        position: chosen.targetVal,
        start: span.start,
        end: span.end,
      },
    },
    active: { key: chosen.key },
  }
}

export function useSmartGuides(nodes: Node[], options: UseSmartGuidesOptions) {
  const [guideLines, setGuideLines] = useState<GuideLine[]>(EMPTY_GUIDE_LINES)
  const metaRef = useRef<NodeMeta | null>(null)
  const lastSnapRef = useRef<LastSnap | null>(null)
  const activeSnapRef = useRef<{ x: ActiveSnap | null; y: ActiveSnap | null }>({ x: null, y: null })
  const altRef = useRef(false)

  // 拖动期间 nodes / zoom / visibleNodes 每帧都是新引用；全部走 ref + getter，
  // 保证 onNodesChangeIntercept 是稳定引用，handleNodesChange 不会每帧重建。
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Alt：临时跳过吸附（自由摆放）。与飞书 / Figma 的「按住修饰键忽略吸附」同理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || event.altKey) altRef.current = true
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) altRef.current = false
    }
    const reset = () => { altRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const resetInteraction = useCallback(() => {
    metaRef.current = null
    lastSnapRef.current = null
    activeSnapRef.current = { x: null, y: null }
    setGuideLines((prev) => (prev.length === 0 ? prev : EMPTY_GUIDE_LINES))
  }, [])

  const onNodesChangeIntercept = useCallback((changes: NodeChange[]) => {
    const nextChanges = [...changes]
    const dragChanges = nextChanges.filter(
      (c): c is PositionChange => c.type === 'position' && c.dragging === true && !!c.position,
    )
    const resizeChanges = nextChanges.filter(
      (c): c is DimensionChange => c.type === 'dimensions' && c.resizing === true && !!c.dimensions,
    )

    // 结束帧：严格用 === false，不能把「xyflow 自动测量」的 dimensions change 误判成结束。
    const hasEnd = nextChanges.some((c) => (
      (c.type === 'position' && c.dragging === false)
      || (c.type === 'dimensions' && c.resizing === false)
    ))

    if (dragChanges.length === 0 && resizeChanges.length === 0) {
      if (hasEnd) {
        // 闭环：React Flow 会用 XYDrag 内部未吸附的位置派发 drag end，
        // 这里必须用最后一帧吸附后的结果覆盖，否则松手即回弹、落盘的是未吸附坐标。
        const last = lastSnapRef.current
        if (last) {
          for (const change of nextChanges) {
            if (change.type === 'position' && change.position) {
              const snapped = last.positions.get(change.id)
              if (snapped) change.position = { x: snapped.x, y: snapped.y }
            }
            if (change.type === 'dimensions' && change.dimensions) {
              const snappedDim = last.dimensions.get(change.id)
              if (snappedDim) {
                change.dimensions = { width: snappedDim.width, height: snappedDim.height }
              }
            }
          }
        }
        resetInteraction()
      }
      return nextChanges
    }

    if (
      useGraphUiStore.getState().smartGuidesEnabled === false
      || altRef.current
    ) {
      resetInteraction()
      return nextChanges
    }

    const zoom = getZoomSafe(optionsRef.current.getZoom)
    const enterThreshold = SNAP_ENTER_SCREEN_PX / zoom
    const releaseThreshold = SNAP_RELEASE_SCREEN_PX / zoom
    const maxLength = MAX_GUIDE_SCREEN_PX / zoom
    const isResize = dragChanges.length === 0 && resizeChanges.length > 0
    const change = isResize ? resizeChanges[0] : dragChanges[0]
    const dragIds = new Set(isResize ? [change.id] : dragChanges.map((c) => c.id))
    // resize 时 React Flow 派发的 position change 不带 dragging（拖左 / 上边才有），
    // 必须从这里取当前左上角，否则会拿 store 里的旧位置算错整条对齐线。
    const pairedPosChange = isResize
      ? nextChanges.find((c): c is PositionChange => c.type === 'position' && c.id === change.id)
      : undefined

    // 拖动对象（多选时是整体包围盒）：吸附只作用于这个矩形，再把同一偏移施加到每个节点。
    const sourceNodes = optionsRef.current.getVisibleNodes() ?? nodesRef.current
    const dragRects: Rect[] = []
    for (const id of dragIds) {
      const found = sourceNodes.find((node) => node.id === id)
      if (!found) continue
      const positionChange = dragChanges.find((c) => c.id === id)
      const currentPosition = isResize ? pairedPosChange?.position : positionChange?.position
      const dimensionChange = isResize ? resizeChanges[0] : undefined
      dragRects.push(readRect(
        found,
        currentPosition ?? undefined,
        dimensionChange?.dimensions ?? undefined,
      ))
    }
    if (dragRects.length === 0) return nextChanges
    const dragRect: Rect = dragRects.reduce((acc, rect) => ({
      left: Math.min(acc.left, rect.left),
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.right),
      bottom: Math.max(acc.bottom, rect.bottom),
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
    }))
    dragRect.width = dragRect.right - dragRect.left
    dragRect.height = dragRect.bottom - dragRect.top
    dragRect.centerX = dragRect.left + dragRect.width / 2
    dragRect.centerY = dragRect.top + dragRect.height / 2

    let meta = metaRef.current
    if (
      !meta || meta.threshold !== enterThreshold
      || dragRect.centerX < meta.bounds.left || dragRect.centerX > meta.bounds.right
      || dragRect.centerY < meta.bounds.top || dragRect.centerY > meta.bounds.bottom
    ) {
      meta = buildNodeMeta(sourceNodes, dragRect, enterThreshold, zoom)
      metaRef.current = meta
    }

    const bucketSize = Math.max(1, enterThreshold * 2)
    const candidateIds = new Set<string>()
    for (const value of [dragRect.left, dragRect.centerX, dragRect.right]) {
      collectNearbyIds(meta.xIndex, value, releaseThreshold, bucketSize, candidateIds)
    }
    for (const value of [dragRect.top, dragRect.centerY, dragRect.bottom]) {
      collectNearbyIds(meta.yIndex, value, releaseThreshold, bucketSize, candidateIds)
    }
    if (isResize) {
      collectNearbyIds(meta.widthIndex, dragRect.width, releaseThreshold, bucketSize, candidateIds)
      collectNearbyIds(meta.heightIndex, dragRect.height, releaseThreshold, bucketSize, candidateIds)
    }

    const xPointsByNode: Array<{ other: Rect; points: AxisPoint[] }> = []
    const yPointsByNode: Array<{ other: Rect; points: AxisPoint[] }> = []
    for (const candidateId of candidateIds) {
      if (dragIds.has(candidateId)) continue
      const otherMeta = meta.byId.get(candidateId)
      if (!otherMeta || otherMeta.node.selected) continue
      const o = otherMeta.rect

      if (isResize) {
        // resize 保留「移动边贴到邻居边」的语义，但不与 move 的对齐语义混用。
        const paired = pairedPosChange
        const movingLeft = paired?.position?.x !== undefined
        const movingTop = paired?.position?.y !== undefined
        const xPoints: AxisPoint[] = []
        const yPoints: AxisPoint[] = []
        if (movingLeft) {
          xPoints.push({ dragVal: dragRect.left, targetVal: o.left, align: 'left', kind: 'edge' })
          xPoints.push({ dragVal: dragRect.left, targetVal: o.right, align: 'left', kind: 'edge' })
        } else {
          xPoints.push({ dragVal: dragRect.right, targetVal: o.right, align: 'right', kind: 'edge' })
          xPoints.push({ dragVal: dragRect.right, targetVal: o.left, align: 'right', kind: 'edge' })
        }
        if (movingTop) {
          yPoints.push({ dragVal: dragRect.top, targetVal: o.top, align: 'top', kind: 'edge' })
          yPoints.push({ dragVal: dragRect.top, targetVal: o.bottom, align: 'top', kind: 'edge' })
        } else {
          yPoints.push({ dragVal: dragRect.bottom, targetVal: o.bottom, align: 'bottom', kind: 'edge' })
          yPoints.push({ dragVal: dragRect.bottom, targetVal: o.top, align: 'bottom', kind: 'edge' })
        }
        if (xPoints.length) xPointsByNode.push({ other: o, points: xPoints })
        if (yPoints.length) yPointsByNode.push({ other: o, points: yPoints })
      } else {
        xPointsByNode.push({
          other: o,
          points: [
            { dragVal: dragRect.left, targetVal: o.left, align: 'left', kind: 'edge' },
            { dragVal: dragRect.right, targetVal: o.right, align: 'right', kind: 'edge' },
            { dragVal: dragRect.centerX, targetVal: o.centerX, align: 'center', kind: 'center' },
          ],
        })
        yPointsByNode.push({
          other: o,
          points: [
            { dragVal: dragRect.top, targetVal: o.top, align: 'top', kind: 'edge' },
            { dragVal: dragRect.bottom, targetVal: o.bottom, align: 'bottom', kind: 'edge' },
            { dragVal: dragRect.centerY, targetVal: o.centerY, align: 'center', kind: 'center' },
          ],
        })
      }
    }

    const priority = CENTER_PRIORITY_SCREEN_PX / zoom
    const xResult = computeAxisSnap({
      axis: 'x', dragRect, pointsByNode: xPointsByNode,
      enterThreshold, releaseThreshold, priority, active: activeSnapRef.current.x, maxLength,
    })
    const yResult = computeAxisSnap({
      axis: 'y', dragRect, pointsByNode: yPointsByNode,
      enterThreshold, releaseThreshold, priority, active: activeSnapRef.current.y, maxLength,
    })
    activeSnapRef.current = { x: xResult.active, y: yResult.active }

    const offsetX = xResult.snap?.offset ?? 0
    const offsetY = yResult.snap?.offset ?? 0
    const snapped: LastSnap = { positions: new Map(), dimensions: new Map() }

    if (!isResize) {
      for (const positionChange of dragChanges) {
        if (!positionChange.position) continue
        positionChange.position = {
          x: positionChange.position.x + offsetX,
          y: positionChange.position.y + offsetY,
        }
        snapped.positions.set(positionChange.id, { ...positionChange.position })
      }
    } else {
      const dimChange = change as DimensionChange
      const paired = pairedPosChange
      const movingLeft = paired?.position?.x !== undefined
      const movingTop = paired?.position?.y !== undefined
      // 位置吸附与尺寸吸附互不覆盖：边对齐只改「正在移动的那条边」，等尺寸只改尺寸。
      let nextLeft = dragRect.left
      let nextTop = dragRect.top
      let nextWidth = dragRect.width
      let nextHeight = dragRect.height
      if (xResult.snap) {
        if (movingLeft) {
          nextLeft = dragRect.left + xResult.snap.offset
          nextWidth = dragRect.right - nextLeft
        } else {
          nextWidth = dragRect.width + xResult.snap.offset
        }
      } else {
        let bestWidth: number | null = null
        let bestDiff = enterThreshold
        for (const candidateId of candidateIds) {
          if (dragIds.has(candidateId)) continue
          const otherMeta = meta.byId.get(candidateId)
          if (!otherMeta || otherMeta.node.selected) continue
          const diff = Math.abs(dragRect.width - otherMeta.rect.width)
          if (diff < bestDiff) { bestDiff = diff; bestWidth = otherMeta.rect.width }
        }
        if (bestWidth !== null) nextWidth = bestWidth
      }
      if (yResult.snap) {
        if (movingTop) {
          nextTop = dragRect.top + yResult.snap.offset
          nextHeight = dragRect.bottom - nextTop
        } else {
          nextHeight = dragRect.height + yResult.snap.offset
        }
      } else {
        let bestHeight: number | null = null
        let bestDiff = enterThreshold
        for (const candidateId of candidateIds) {
          if (dragIds.has(candidateId)) continue
          const otherMeta = meta.byId.get(candidateId)
          if (!otherMeta || otherMeta.node.selected) continue
          const diff = Math.abs(dragRect.height - otherMeta.rect.height)
          if (diff < bestDiff) { bestDiff = diff; bestHeight = otherMeta.rect.height }
        }
        if (bestHeight !== null) nextHeight = bestHeight
      }
      nextWidth = Math.max(nextWidth, 10)
      nextHeight = Math.max(nextHeight, 10)
      if (dimChange.dimensions) {
        dimChange.dimensions = { width: nextWidth, height: nextHeight }
        snapped.dimensions.set(dimChange.id, { width: nextWidth, height: nextHeight })
      }
      if (paired?.position) {
        paired.position = { x: movingLeft ? nextLeft : dragRect.left, y: movingTop ? nextTop : dragRect.top }
        snapped.positions.set(paired.id, { ...paired.position })
      }
    }

    // 没有真正吸附时不记录，避免结束帧把节点钉在原地。
    lastSnapRef.current = (offsetX !== 0 || offsetY !== 0 || snapped.dimensions.size > 0)
      ? snapped
      : null

    const newGuideLines: GuideLine[] = []
    if (xResult.snap) newGuideLines.push(xResult.snap.guide)
    if (yResult.snap) newGuideLines.push(yResult.snap.guide)
    setGuideLines((prev) => (guideLinesEqual(prev, newGuideLines) ? prev : newGuideLines))

    return nextChanges
  }, [resetInteraction])

  const clearGuides = useCallback(() => {
    resetInteraction()
  }, [resetInteraction])

  return { guideLines, onNodesChangeIntercept, clearGuides }
}
