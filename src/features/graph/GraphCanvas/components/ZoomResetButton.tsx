/**
 * 左下角「一键重置视角到 100%」按钮（渲染在 CanvasMiniMap 的 bottom-left 按钮组里）。
 *
 * 【用户决策 2026-11-10】100% 已是放大上限：节点全部展示、细节完整，
 * 再放大只会虚胖、不产生新信息。因此远景看完主干后需要一个顺手的一键回程入口。
 *
 * 与左上角 LodControl 的 100% 复位按钮完全同源：只做一次
 * `zoomTo(ZOOM_REFERENCE)`，**保持当前平移位置**。不做 fitView —— 它会按
 * 内容包围盒重算比例，结果往往不是 100%，还会牵动 viewport 落盘与「返回上个视野」。
 */
import { memo, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Focus } from 'lucide-react'
import {
  ZOOM_REFERENCE,
  ZOOM_TRANSITION_MS,
  formatZoomPercent,
  isAtMaxZoom,
} from '../../../../domain/graph/zoomScale'

interface ZoomResetButtonProps {
  /** raw 变换系数，只用于把当前百分比暴露给 GUI 诊断，不参与换算 */
  zoomLevel: number
}

export default memo(function ZoomResetButton({ zoomLevel }: ZoomResetButtonProps) {
  const reactFlow = useReactFlow()
  // 100% 就是上限，所以「已在 100%」与「已到放大端点」是同一判定；
  // 与 LodControl 共用 isAtMaxZoom，避免两处浮点容差不一致。
  const atReference = isAtMaxZoom(zoomLevel)

  const handleReset = useCallback(() => {
    void reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS })
  }, [reactFlow])

  return (
    <button
      type="button"
      data-tm-zoom-reset-view=""
      data-tm-zoom-percent={formatZoomPercent(zoomLevel)}
      data-tm-zoom-at-reference={atReference ? 'true' : 'false'}
      aria-label="一键重置视角到 100%"
      title="一键重置视角到 100%（常规比例，保持当前平移位置）"
      onClick={handleReset}
      className="nodrag nowheel pointer-events-auto flex h-6 items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium tabular-nums text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
    >
      <Focus className="h-3 w-3" aria-hidden="true" />
      100%
    </button>
  )
})
