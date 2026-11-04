import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { CurveControl } from '../../../../domain/graph/edgeCurve'
import { getCurveControlPoint, resolveCurveControlFromDrag } from './floatingUtils'

interface EdgeBendHandleProps {
  /** 线头两端（flow 坐标，已含出线间隙），曲线从这两点起笔 */
  sx: number
  sy: number
  tx: number
  ty: number
  /** 当前控制点，决定手柄位置 */
  control: CurveControl
  /** 拖动中只改父组件的路径预览，不写 store，避免每帧产生撤销记录 */
  onPreview: (control: CurveControl | null) => void
  /** 松手时一次性写库并落盘 */
  onCommit: (control: CurveControl) => void
  /** 双击复位成直线 */
  onReset: () => void
}

/**
 * 曲线模式下落在「曲线上的控制点」处的可拖拽手柄。
 *
 * 放在 EdgeLabelRenderer 内（该层已带 viewport transform，直接用 flow 坐标定位）。
 * 与早期版本的区别：手柄不再被钉死在弧长中点、也不仅能沿法向移动——
 * 指针的两个分量分别投影到连线方向（弯曲位置 u）与法向（弯曲幅度 v），
 * 因此一次拖动即可同时调整「在哪弯」和「弯多深」。
 * 松手才写库；双击复位成直线。
 */
export default function EdgeBendHandle({
  sx,
  sy,
  tx,
  ty,
  control,
  onPreview,
  onCommit,
  onReset,
}: EdgeBendHandleProps) {
  const { screenToFlowPosition } = useReactFlow()
  const dragRef = useRef<{ moved: boolean; startClientX: number; startClientY: number } | null>(null)

  // 手柄位置严格等于曲线经过的点（与 getCurvedEdgePath 的 Q(0.5) 一致）
  const handle = getCurveControlPoint(sx, sy, tx, ty, control)

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { moved: false, startClientX: event.clientX, startClientY: event.clientY }
    onPreview(control)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [control, onPreview])

  const moveDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    // 与目录拖动把手一致：位移 <3px 视为点击 / 手抖，既不做预览也不写库。
    // 否则单击手柄、双击复位都会平白产生一次 setEdges + 落盘 + 撤销记录。
    if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 3) return
    drag.moved = true
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const next = resolveCurveControlFromDrag(sx, sy, tx, ty, pointer.x, pointer.y)
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
      onCommit(resolveCurveControlFromDrag(sx, sy, tx, ty, pointer.x, pointer.y))
    }
    onPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [screenToFlowPosition, sx, sy, tx, ty, onCommit, onPreview])

  return (
    <div
      className="nodrag nopan flex h-5 w-5 touch-none items-center justify-center"
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${handle.x}px, ${handle.y}px)`,
        pointerEvents: 'all',
        // 高于快捷工具栏（10）与锚点手柄（11）：曲线控制点是当前主要操作对象
        zIndex: 12,
      }}
      title="拖动调整弯曲位置与幅度（左右改位置、上下改弧度）· 双击复位成直线"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
    >
      {/* 菱形区别于两端的圆形锚点手柄，避免混淆 */}
      <div className="h-3 w-3 rotate-45 cursor-move rounded-[3px] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] transition-transform duration-100 hover:scale-125 active:cursor-grabbing" />
    </div>
  )
}
