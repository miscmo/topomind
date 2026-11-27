/**
 * 远景只读提示条（画布顶部居中浮层组的第一行内容）。
 *
 * 只读不是「静默拦截」：用户拖动节点却发现不动，会以为应用卡了。这里明确告知
 * 「当前比例下画布信息失真、所有编辑已停用」，并给一个一键回到 100% 的入口。
 * 【2026-11-24】左下角的比例尺 / 步进缩放 / 复位按钮与缩略图已整体移除，
 * 这里是唯一的比例恢复入口：只 zoomTo，不改 pan、不 fitView。
 *
 * 【2026-11-27】缩放比例滑动条已下线；顶部浮层由 GraphCanvas 用**唯一**一个
 * top-center Panel 统一托管，按「只读提示条 → 房间面包屑 → 选中操作菜单」纵向排列，
 * 避免多个同位置 Panel 互相遮挡。本组件只负责自己这一行，不再包裹 Panel。
 * 外层容器 pointer-events-none，只有卡片自己吃鼠标事件，间隙不挡画布。
 */
import { memo, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
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
    <div
      data-tm-canvas-readonly-banner=""
      data-tm-canvas-readonly-reason={state.reason}
      data-tm-canvas-readonly-hidden={state.hiddenNodeCount}
      className="nodrag nowheel pointer-events-auto gap-2 px-3 py-2 text-[12px] text-[var(--color-text)] tm-pill"
    >
      <Lock className="tm-icon text-[var(--color-accent)]" aria-hidden="true" />
      <span>
        画布只读 · 当前 {formatZoomPercent(zoomLevel)}{reasonText}，恢复 100% 后可编辑
      </span>
      <button
        type="button"
        data-tm-canvas-readonly-restore=""
        onClick={handleRestore}
        className="nodrag nowheel pointer-events-auto ml-1 flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-inverse)] hover:opacity-90"
      >
        <Focus className="tm-icon tm-icon--sm" aria-hidden="true" />
        恢复 100%
      </button>
    </div>
  )
})
