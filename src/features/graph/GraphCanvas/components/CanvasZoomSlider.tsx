/**
 * 只读提示条下方的缩放滑动条（与提示条同挂在 React Flow 的 top-center Panel）。
 *
 * 【用户决策 2026-11-11 晚】「现在只是一个比例数字」，要能拖动快速调整缩放比例；
 * 「滑动条出现隐藏的逻辑和只读提示控件一致」。因此本组件**不自己判定可见性**：
 * 由 CanvasReadOnlyBanner 在退出只读时把整块一起卸载，100% / 无隐藏节点
 * 时两者同时消失，缩小时两者同时出现。
 *
 * 只做 `zoomTo(fromDisplayPercent(p))`：保持当前 pan，不 fitView、不改任何节点坐标，
 * 与「恢复 100%」按钮同源；duration=0 让拖动即时跟手，避免 240ms 过渡滞后。
 */
import { memo, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  MAX_DISPLAY_PERCENT,
  MIN_DISPLAY_PERCENT,
  fromDisplayPercent,
  toDisplayPercent,
} from '../../../../domain/graph/zoomScale'

interface CanvasZoomSliderProps {
  /** raw 变换系数，显示百分比一律走 zoomScale 换算 */
  zoomLevel: number
}

export default memo(function CanvasZoomSlider({ zoomLevel }: CanvasZoomSliderProps) {
  const reactFlow = useReactFlow()
  const percent = Math.min(MAX_DISPLAY_PERCENT,
    Math.max(MIN_DISPLAY_PERCENT, toDisplayPercent(zoomLevel)))

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    if (!Number.isFinite(next)) return
    void reactFlow.zoomTo(fromDisplayPercent(next), { duration: 0 })
  }, [reactFlow])

  return (
    <div
      data-tm-canvas-zoom-slider=""
      data-tm-canvas-zoom-slider-value={percent}
      data-tm-canvas-zoom-slider-min={MIN_DISPLAY_PERCENT}
      data-tm-canvas-zoom-slider-max={MAX_DISPLAY_PERCENT}
      className="nodrag nowheel pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-text-secondary)] shadow-[var(--shadow-popover)]"
    >
      <span className="text-[10px] tabular-nums">{MIN_DISPLAY_PERCENT}%</span>
      <input
        type="range"
        min={MIN_DISPLAY_PERCENT}
        max={MAX_DISPLAY_PERCENT}
        step={1}
        value={percent}
        onChange={handleChange}
        aria-label="缩放比例"
        aria-valuetext={`${percent}%`}
        title="拖动快速调整缩放比例（5% ~ 100%）"
        data-tm-canvas-zoom-slider-input=""
        className="nodrag nowheel pointer-events-auto w-[220px] cursor-pointer"
        style={{ accentColor: 'var(--color-accent)' }}
      />
      <span className="text-[10px] tabular-nums">{MAX_DISPLAY_PERCENT}%</span>
      <span
        data-tm-canvas-zoom-slider-readout=""
        className="min-w-[34px] text-right text-[11px] font-semibold tabular-nums text-[var(--color-accent)]"
      >
        {percent}%
      </span>
    </div>
  )
})
