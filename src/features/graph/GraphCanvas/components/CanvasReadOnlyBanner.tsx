/**
 * 远景只读提示条（挂在 ReactFlow 的 top-center Panel 里）。
 *
 * 只读不是「静默拦截」：用户拖动节点却发现不动，会以为应用卡了。这里明确告知
 * 「当前比例下画布信息失真、所有编辑已停用」，并给一个一键回到 100% 的入口，
 * 与左下角 ZoomResetButton 完全同源（只 zoomTo，不改 pan、不 fitView）。
 */
import { memo, useCallback } from 'react'
import { Panel, useReactFlow } from '@xyflow/react'
import { Lock, Focus } from 'lucide-react'
import {
  ZOOM_REFERENCE,
  ZOOM_TRANSITION_MS,
  formatZoomPercent,
} from '../../../../domain/graph/zoomScale'
import type { CanvasReadOnlyState } from '../../../../domain/graph/canvasReadOnly'

interface CanvasReadOnlyBannerProps {
  state: CanvasReadOnlyState
  /** 只用于展示当前百分比，判定一律走 state */
  zoomLevel: number
}

export default memo(function CanvasReadOnlyBanner({ state, zoomLevel }: CanvasReadOnlyBannerProps) {
  const reactFlow = useReactFlow()
  const handleRestore = useCallback(() => {
    void reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS })
  }, [reactFlow])

  if (!state.readOnly) return null

  const reasonText = state.hiddenNodeCount > 0
    ? ` · ${state.hiddenNodeCount} 个节点已隐藏`
    : ' · 坐标已缩放'

  return (
    <Panel position="top-center" className="!m-3">
      <div
        data-tm-canvas-readonly-banner=""
        data-tm-canvas-readonly-reason={state.reason}
        data-tm-canvas-readonly-hidden={state.hiddenNodeCount}
        className="nodrag nowheel pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text)] shadow-[var(--shadow-popover)]"
      >
        <Lock className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
        <span>
          画布只读 · 当前 {formatZoomPercent(zoomLevel)}{reasonText}，恢复 100% 后可编辑
        </span>
        <button
          type="button"
          data-tm-canvas-readonly-restore=""
          onClick={handleRestore}
          className="nodrag nowheel pointer-events-auto ml-1 flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-inverse)] hover:opacity-90"
        >
          <Focus className="h-3 w-3" aria-hidden="true" />
          恢复 100%
        </button>
      </div>
    </Panel>
  )
})
