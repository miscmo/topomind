import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  resolveAnchorPoint,
  toEdgeAnchor,
  type AnchorRect,
  type EdgeAnchor,
  type EdgeAnchorPatch,
} from '../../../../domain/graph/edgeAnchors'

export type EdgeAnchorSideKey = 'source' | 'target'

export interface EdgeAnchorPreview {
  side: EdgeAnchorSideKey
  anchor: EdgeAnchor
}

interface EdgeAnchorHandlesProps {
  sourceRect: AnchorRect
  targetRect: AnchorRect
  /** 当前渲染出的两个端点（flow 坐标），手柄就贴在这里 */
  sourcePoint: { x: number; y: number }
  targetPoint: { x: number; y: number }
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  /** 拖动中只改父组件的路径预览，不写 store，避免每帧产生撤销记录 */
  onPreview: (preview: EdgeAnchorPreview | null) => void
  /** 松手时一次性写库并落盘 */
  onCommit: (patch: EdgeAnchorPatch) => void
}

/**
 * 选中连线后显示的两个锚点手柄（起点端 / 终点端互相独立）。
 *
 * 放在 EdgeLabelRenderer 内：该层已经带 viewport transform，直接用 flow 坐标定位。
 * 拖动时把屏幕坐标转回 flow 坐标，再换算成相对节点矩形的 (u, v)，
 * toEdgeAnchor 会把它钳制在 [0, 1]，所以锚点最多只能停在节点边框上。
 */
export default function EdgeAnchorHandles({
  sourceRect,
  targetRect,
  sourcePoint,
  targetPoint,
  sourceAnchor,
  targetAnchor,
  onPreview,
  onCommit,
}: EdgeAnchorHandlesProps) {
  const { screenToFlowPosition } = useReactFlow()
  const dragRef = useRef<{
    side: EdgeAnchorSideKey
    rect: AnchorRect
    grab: { x: number; y: number }
  } | null>(null)
  const previewAnchorRef = useRef<EdgeAnchor | null>(null)

  const beginDrag = useCallback((side: EdgeAnchorSideKey, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = side === 'source' ? sourceRect : targetRect
    const anchor = side === 'source' ? sourceAnchor : targetAnchor
    const current = resolveAnchorPoint(rect, anchor) ?? (side === 'source' ? sourcePoint : targetPoint)
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    dragRef.current = {
      side,
      rect,
      // 记住按下点相对手柄的偏移，避免手柄瞬间跳到指针中心
      grab: { x: pointer.x - current.x, y: pointer.y - current.y },
    }
    previewAnchorRef.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [screenToFlowPosition, sourceRect, targetRect, sourceAnchor, targetAnchor, sourcePoint, targetPoint])

  const moveDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const next = toEdgeAnchor(drag.rect, {
      x: pointer.x - drag.grab.x,
      y: pointer.y - drag.grab.y,
    })
    if (!next) return
    previewAnchorRef.current = next
    onPreview({ side: drag.side, anchor: next })
  }, [screenToFlowPosition, onPreview])

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    const anchor = previewAnchorRef.current
    dragRef.current = null
    previewAnchorRef.current = null
    if (commit && anchor) {
      onCommit({ [`${drag.side}Anchor`]: anchor } as EdgeAnchorPatch)
    }
    onPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [onCommit, onPreview])

  return (
    <>
      {(['source', 'target'] as const).map((side) => {
        const point = side === 'source' ? sourcePoint : targetPoint
        return (
          <div
            key={side}
            data-anchor-side={side}
            className="nodrag nopan flex h-4 w-4 touch-none items-center justify-center"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
              pointerEvents: 'all',
              zIndex: 10,
            }}
            title={side === 'source'
              ? '拖动调整起点锚点（仅影响本条连线）'
              : '拖动调整终点锚点（仅影响本条连线）'}
            onPointerDown={(event) => beginDrag(side, event)}
            onPointerMove={moveDrag}
            onPointerUp={(event) => finishDrag(event, true)}
            onPointerCancel={(event) => finishDrag(event, false)}
            onLostPointerCapture={(event) => finishDrag(event, false)}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className="h-3 w-3 cursor-grab rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] transition-transform duration-100 hover:scale-125 active:cursor-grabbing" />
          </div>
        )
      })}
    </>
  )
}
