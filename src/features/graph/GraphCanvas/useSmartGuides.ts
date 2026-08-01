import { useCallback, useRef, useState } from 'react'
import type { Node, NodeChange } from '@xyflow/react'

const SNAP_THRESHOLD = 8
const GUIDE_BUCKET_SIZE = SNAP_THRESHOLD * 2

type GuideIndex = Map<number, Set<string>>

function addToGuideIndex(index: GuideIndex, value: number, nodeId: string) {
  const bucket = Math.floor(value / GUIDE_BUCKET_SIZE)
  const ids = index.get(bucket)
  if (ids) ids.add(nodeId)
  else index.set(bucket, new Set([nodeId]))
}

function collectNearbyIds(index: GuideIndex, value: number, target: Set<string>) {
  const start = Math.floor((value - SNAP_THRESHOLD) / GUIDE_BUCKET_SIZE)
  const end = Math.floor((value + SNAP_THRESHOLD) / GUIDE_BUCKET_SIZE)
  for (let bucket = start; bucket <= end; bucket += 1) {
    for (const nodeId of index.get(bucket) ?? []) target.add(nodeId)
  }
}

function buildNodeMeta(nodes: Node[]) {
  const byId = new Map<string, { node: Node; rect: ReturnType<typeof getNodeRect> }>()
  const xIndex: GuideIndex = new Map()
  const yIndex: GuideIndex = new Map()
  const widthIndex: GuideIndex = new Map()
  const heightIndex: GuideIndex = new Map()
  let selectedNodeCount = 0
  for (const node of nodes) {
    if (node.selected) selectedNodeCount += 1
    const rect = getNodeRect(node)
    byId.set(node.id, { node, rect })
    for (const value of [rect.left, rect.centerX, rect.right]) addToGuideIndex(xIndex, value, node.id)
    for (const value of [rect.top, rect.centerY, rect.bottom]) addToGuideIndex(yIndex, value, node.id)
    addToGuideIndex(widthIndex, rect.width, node.id)
    addToGuideIndex(heightIndex, rect.height, node.id)
  }
  return { byId, xIndex, yIndex, widthIndex, heightIndex, selectedNodeCount }
}

export type GuideLine = {
  id: string
  type: 'vertical' | 'horizontal'
  position: number
  start: number
  end: number
}

function getNodeRect(node: Node, pos?: { x?: number, y?: number }, dim?: { width?: number, height?: number }) {
  const x = pos?.x ?? node.position.x
  const y = pos?.y ?? node.position.y
  const width = dim?.width ?? node.width ?? node.initialWidth ?? node.measured?.width ?? 120
  const height = dim?.height ?? node.height ?? node.initialHeight ?? node.measured?.height ?? 52
  return {
    left: x,
    centerX: x + width / 2,
    right: x + width,
    top: y,
    centerY: y + height / 2,
    bottom: y + height,
    width,
    height,
  }
}

export function useSmartGuides(nodes: Node[]) {
  const [guideLines, setGuideLines] = useState<GuideLine[]>([])
  const activeNodeMetaRef = useRef<ReturnType<typeof buildNodeMeta> | null>(null)
  
  const onNodesChangeIntercept = useCallback((changes: NodeChange[]) => {
    const nextChanges = [...changes]
    const newGuideLines: GuideLine[] = []
    
    // Check for position drag or dimension resize
    const dragChanges = nextChanges.filter(c => c.type === 'position' && c.dragging && c.position) as Extract<NodeChange, { type: 'position' }>[]
    const resizeChanges = nextChanges.filter(c => c.type === 'dimensions' && c.resizing && c.dimensions) as Extract<NodeChange, { type: 'dimensions' }>[]
    
    if (dragChanges.length === 0 && resizeChanges.length === 0) {
      const hasEnd = nextChanges.some(c => (c.type === 'position' && !c.dragging) || (c.type === 'dimensions' && !c.resizing))
      if (hasEnd) {
        activeNodeMetaRef.current = null
        setGuideLines([])
      }
      return nextChanges
    }

    const nodeMeta = activeNodeMetaRef.current ?? buildNodeMeta(nodes)
    activeNodeMetaRef.current = nodeMeta
    const change = (dragChanges.length > 0 ? dragChanges[0] : resizeChanges[0]) as any
    const draggedNodeMeta = nodeMeta.byId.get(change.id)
    if (!draggedNodeMeta) return nextChanges
    const draggedNode = draggedNodeMeta.node
    if (nodeMeta.selectedNodeCount > 1) {
      setGuideLines([])
      return nextChanges
    }

    const isResize = change.type === 'dimensions'
    // React Flow usually dispatches a position change along with dimensions when top/left is dragged.
    const pairedPosChange = isResize ? nextChanges.find(c => c.type === 'position' && c.id === change.id) as Extract<NodeChange, { type: 'position' }> | undefined : null;

    const currentPos = {
      x: (change.type === 'position' && change.position?.x !== undefined) ? change.position.x : (pairedPosChange?.position?.x ?? draggedNode.position.x),
      y: (change.type === 'position' && change.position?.y !== undefined) ? change.position.y : (pairedPosChange?.position?.y ?? draggedNode.position.y),
    }

    const currentDim = {
      width: (change.type === 'dimensions' && change.dimensions?.width !== undefined) ? change.dimensions.width : (draggedNode.width ?? 120),
      height: (change.type === 'dimensions' && change.dimensions?.height !== undefined) ? change.dimensions.height : (draggedNode.height ?? 52),
    }

    const dragRect = getNodeRect(draggedNode, currentPos, currentDim)

    // Accurate detection of which edge is moving during a resize
    let movingLeft = false, movingRight = false, movingTop = false, movingBottom = false;
    if (isResize) {
      movingLeft = pairedPosChange?.position?.x !== undefined;
      movingRight = !movingLeft;
      movingTop = pairedPosChange?.position?.y !== undefined;
      movingBottom = !movingTop;
    }

    let bestSnapX: { diff: number, snapX?: number, snapWidth?: number, guide?: GuideLine } | null = null;
    let bestSnapY: { diff: number, snapY?: number, snapHeight?: number, guide?: GuideLine } | null = null;
    const candidateIds = new Set<string>()
    for (const value of [dragRect.left, dragRect.centerX, dragRect.right]) {
      collectNearbyIds(nodeMeta.xIndex, value, candidateIds)
    }
    for (const value of [dragRect.top, dragRect.centerY, dragRect.bottom]) {
      collectNearbyIds(nodeMeta.yIndex, value, candidateIds)
    }
    if (isResize) {
      collectNearbyIds(nodeMeta.widthIndex, dragRect.width, candidateIds)
      collectNearbyIds(nodeMeta.heightIndex, dragRect.height, candidateIds)
    }

    for (const candidateId of candidateIds) {
      const otherMeta = nodeMeta.byId.get(candidateId)
      if (!otherMeta) continue
      const other = otherMeta.node
      if (other.id === draggedNode.id || other.selected) continue
      const oRect = otherMeta.rect

      // === X Axis ===
      const xPoints = [];
      if (isResize) {
        if (movingLeft) {
          xPoints.push({ dragVal: dragRect.left, targetVal: oRect.left, type: 'left' });
          xPoints.push({ dragVal: dragRect.left, targetVal: oRect.right, type: 'left' });
        }
        if (movingRight) {
          xPoints.push({ dragVal: dragRect.right, targetVal: oRect.right, type: 'right' });
          xPoints.push({ dragVal: dragRect.right, targetVal: oRect.left, type: 'right' });
        }
      } else {
        // Less chaotic snaps during move
        xPoints.push({ dragVal: dragRect.left, targetVal: oRect.left, type: 'left' });
        xPoints.push({ dragVal: dragRect.left, targetVal: oRect.right, type: 'left' });
        xPoints.push({ dragVal: dragRect.right, targetVal: oRect.right, type: 'right' });
        xPoints.push({ dragVal: dragRect.right, targetVal: oRect.left, type: 'right' });
        xPoints.push({ dragVal: dragRect.centerX, targetVal: oRect.centerX, type: 'center' });
      }

      for (const p of xPoints) {
        const diff = Math.abs(p.dragVal - p.targetVal);
        if (diff < (bestSnapX?.diff ?? SNAP_THRESHOLD)) {
          let snapX: number | undefined;
          let snapWidth: number | undefined;

          if (isResize) {
            if (p.type === 'left') {
              snapX = p.targetVal;
              snapWidth = dragRect.right - p.targetVal;
            } else if (p.type === 'right') {
              snapWidth = p.targetVal - dragRect.left;
            }
          } else {
            if (p.type === 'left') snapX = p.targetVal;
            else if (p.type === 'right') snapX = p.targetVal - dragRect.width;
            else if (p.type === 'center') snapX = p.targetVal - dragRect.width / 2;
          }

          bestSnapX = {
            diff,
            snapX,
            snapWidth,
            guide: {
              id: `v-${p.targetVal}`,
              type: 'vertical',
              position: p.targetVal,
              start: Math.min(dragRect.top, oRect.top),
              end: Math.max(dragRect.bottom, oRect.bottom)
            }
          };
        }
      }

      // Dimension Snapping (Width)
      if (isResize && (movingLeft || movingRight)) {
        const diffW = Math.abs(dragRect.width - oRect.width);
        if (diffW < (bestSnapX?.diff ?? SNAP_THRESHOLD)) {
           bestSnapX = {
              diff: diffW,
              snapWidth: oRect.width,
              snapX: movingLeft ? dragRect.right - oRect.width : undefined,
              // No visual guide line for pure dimension snapping to keep UI clean
           };
        }
      }

      // === Y Axis ===
      const yPoints = [];
      if (isResize) {
        if (movingTop) {
          yPoints.push({ dragVal: dragRect.top, targetVal: oRect.top, type: 'top' });
          yPoints.push({ dragVal: dragRect.top, targetVal: oRect.bottom, type: 'top' });
        }
        if (movingBottom) {
          yPoints.push({ dragVal: dragRect.bottom, targetVal: oRect.bottom, type: 'bottom' });
          yPoints.push({ dragVal: dragRect.bottom, targetVal: oRect.top, type: 'bottom' });
        }
      } else {
        // Less chaotic snaps during move
        yPoints.push({ dragVal: dragRect.top, targetVal: oRect.top, type: 'top' });
        yPoints.push({ dragVal: dragRect.top, targetVal: oRect.bottom, type: 'top' });
        yPoints.push({ dragVal: dragRect.bottom, targetVal: oRect.bottom, type: 'bottom' });
        yPoints.push({ dragVal: dragRect.bottom, targetVal: oRect.top, type: 'bottom' });
        yPoints.push({ dragVal: dragRect.centerY, targetVal: oRect.centerY, type: 'center' });
      }

      for (const p of yPoints) {
        const diff = Math.abs(p.dragVal - p.targetVal);
        if (diff < (bestSnapY?.diff ?? SNAP_THRESHOLD)) {
          let snapY: number | undefined;
          let snapHeight: number | undefined;

          if (isResize) {
            if (p.type === 'top') {
              snapY = p.targetVal;
              snapHeight = dragRect.bottom - p.targetVal;
            } else if (p.type === 'bottom') {
              snapHeight = p.targetVal - dragRect.top;
            }
          } else {
            if (p.type === 'top') snapY = p.targetVal;
            else if (p.type === 'bottom') snapY = p.targetVal - dragRect.height;
            else if (p.type === 'center') snapY = p.targetVal - dragRect.height / 2;
          }

          bestSnapY = {
            diff,
            snapY,
            snapHeight,
            guide: {
              id: `h-${p.targetVal}`,
              type: 'horizontal',
              position: p.targetVal,
              start: Math.min(dragRect.left, oRect.left),
              end: Math.max(dragRect.right, oRect.right)
            }
          };
        }
      }

      // Dimension Snapping (Height)
      if (isResize && (movingTop || movingBottom)) {
        const diffH = Math.abs(dragRect.height - oRect.height);
        if (diffH < (bestSnapY?.diff ?? SNAP_THRESHOLD)) {
           bestSnapY = {
              diff: diffH,
              snapHeight: oRect.height,
              snapY: movingTop ? dragRect.bottom - oRect.height : undefined,
              // No visual guide line for pure dimension snapping to keep UI clean
           };
        }
      }
    }

    if (isResize) {
      const dimChange = change as Extract<NodeChange, { type: 'dimensions' }>
      if (bestSnapX?.snapWidth !== undefined && dimChange.dimensions) dimChange.dimensions.width = Math.max(bestSnapX.snapWidth, 10)
      if (bestSnapY?.snapHeight !== undefined && dimChange.dimensions) dimChange.dimensions.height = Math.max(bestSnapY.snapHeight, 10)
      if (pairedPosChange && pairedPosChange.position) {
        if (bestSnapX?.snapX !== undefined) pairedPosChange.position.x = bestSnapX.snapX
        if (bestSnapY?.snapY !== undefined) pairedPosChange.position.y = bestSnapY.snapY
      }
    } else {
      const posChange = change as Extract<NodeChange, { type: 'position' }>
      if (bestSnapX?.snapX !== undefined && posChange.position) posChange.position.x = bestSnapX.snapX
      if (bestSnapY?.snapY !== undefined && posChange.position) posChange.position.y = bestSnapY.snapY
    }

    if (bestSnapX?.guide) newGuideLines.push(bestSnapX.guide)
    if (bestSnapY?.guide) newGuideLines.push(bestSnapY.guide)

    setGuideLines(newGuideLines)

    return nextChanges
  }, [nodes])

  const clearGuides = useCallback(() => {
    activeNodeMetaRef.current = null
    setGuideLines([])
  }, [])

  return {
    guideLines,
    onNodesChangeIntercept,
    clearGuides
  }
}
