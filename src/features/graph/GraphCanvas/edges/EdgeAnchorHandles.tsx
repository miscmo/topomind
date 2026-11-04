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
  /** 两端的边框交点（flow 坐标），手柄贴在这里；线头在其外侧 6px */
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
 * 手柄贴在节点边框的交点上（不是线头）：锚点只决定出线位置，线与边框之间
 * 仍保留原有的 6px 间隙。拖动时把屏幕坐标转回 flow 坐标，toEdgeAnchor 会把
 * 指针投影到最近的边框，因此锚点只能沿四条边滑动、不会跑到节点内部。
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
    moved: boolean
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
      moved: false,
    }
    // 按下即进入拖动预览：让快捷工具栏先淡出，避免浮层压住另一端的手柄视线
    const startAnchor = toEdgeAnchor(rect, current)
    previewAnchorRef.current = startAnchor ?? null
    if (startAnchor) onPreview({ side, anchor: startAnchor })
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [screenToFlowPosition, sourceRect, targetRect, sourceAnchor, targetAnchor, sourcePoint, targetPoint, onPreview])

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
    drag.moved = true
    previewAnchorRef.current = next
    onPreview({ side: drag.side, anchor: next })
  }, [screenToFlowPosition, onPreview])

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    const anchor = previewAnchorRef.current
    // 只是点一下手柄没拖动，不该写库（否则会平白多出一条撤销记录）
    const shouldCommit = commit && drag.moved && anchor != null
    dragRef.current = null
    previewAnchorRef.current = null
    if (shouldCommit) {
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
              // 高于快捷工具栏（z-index 10）：即使工具栏避让失败落到手柄上，
              // 手柄依然能优先抓到指针
              zIndex: 11,
            }}
            title={side === 'source'
              ? '沿节点边框拖动，调整本条连线的出线位置'
              : '沿节点边框拖动，调整本条连线的入线位置'}
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
