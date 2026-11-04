import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { getCurvedEdgePath, resolveCurveBendFromDrag } from './floatingUtils'

interface EdgeBendHandleProps {
  /** 线头两端（flow 坐标，已含出线间隙），曲线从这两点起笔 */
  sx: number
  sy: number
  tx: number
  ty: number
  /** 当前弯曲度 [-1, 1]，决定手柄初始位置 */
  bend: number
  /** 拖动中只改父组件的路径预览，不写 store，避免每帧产生撤销记录 */
  onPreview: (bend: number | null) => void
  /** 松手时一次性写库并落盘 */
  onCommit: (bend: number) => void
}

/**
 * 曲线模式下，连线弧长中点处的一个可拖拽控制柄。
 *
 * 放在 EdgeLabelRenderer 内（该层已带 viewport transform，直接用 flow 坐标定位）。
 * 拖动手柄时把屏幕坐标转回 flow 坐标，按其相对连线中点的「垂直位移」反推弯曲度，
 * 因此手柄永远贴着曲线弓得最高的位置、沿法向滑动；松手才写库。
 */
export default function EdgeBendHandle({
  sx,
  sy,
  tx,
  ty,
  bend,
  onPreview,
  onCommit,
}: EdgeBendHandleProps) {
  const { screenToFlowPosition } = useReactFlow()
  const dragRef = useRef<{ moved: boolean } | null>(null)

  // 手柄位置 = 曲线弧长中点（与 getCurvedEdgePath 的 label 完全一致）
  const [, handleX, handleY] = getCurvedEdgePath(sx, sy, tx, ty, bend)

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { moved: false }
    onPreview(bend)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [bend, onPreview])

  const moveDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    event.stopPropagation()
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const next = resolveCurveBendFromDrag(sx, sy, tx, ty, pointer.x, pointer.y)
    dragRef.current.moved = true
    onPreview(next)
  }, [screenToFlowPosition, sx, sy, tx, ty, onPreview])

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!dragRef.current) return
    event.stopPropagation()
    const moved = dragRef.current.moved
    dragRef.current = null
    // 只是点一下没拖动，不该写库（否则会平白多出一条撤销记录）
    if (commit && moved) {
      const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      onCommit(resolveCurveBendFromDrag(sx, sy, tx, ty, pointer.x, pointer.y))
    }
    onPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [screenToFlowPosition, sx, sy, tx, ty, onCommit, onPreview])

  return (
    <div
      className="nodrag nopan flex h-4 w-4 touch-none items-center justify-center"
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${handleX}px, ${handleY}px)`,
        pointerEvents: 'all',
        // 高于快捷工具栏（z-index 10）：即使避让失败落到手柄上，手柄也能优先抓到指针
        zIndex: 11,
      }}
      title="上下拖动调整曲线弧度（仅本连线）"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="h-3 w-3 cursor-grab rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] transition-transform duration-100 hover:scale-125 active:cursor-grabbing" />
    </div>
  )
}
