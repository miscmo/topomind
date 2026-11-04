import { memo, useEffect, useState } from 'react'
import { PaintRoller, RotateCcw, SlidersHorizontal, Spline, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EdgeStylePatch } from '../../../../types'
import QuickEdgeStylePopover, { type QuickEdgeStyle } from './QuickEdgeStylePopover'

interface QuickEdgeToolbarProps {
  /** 当前连线的样式快照（用于快捷面板回显） */
  edgeStyle: QuickEdgeStyle
  isFormatPainterActive: boolean
  /** 本条连线是否设置了自定义锚点（决定要不要显示复位按钮） */
  hasCustomAnchors: boolean
  /** 本条曲线是否偏离默认直线（决定要不要显示复位弯曲按钮） */
  hasCustomCurve: boolean
  /** 浮窗内所有样式改动的统一入口（线型 / 线条 / 粗细 / 颜色 / 色块） */
  onStyleChange: (patch: EdgeStylePatch) => void
  onToggleFormatPainter: () => void
  onResetAnchors: () => void
  onResetCurve: () => void
  onDelete: () => void
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation()
}

/**
 * 选中连线后浮在连线中点上方的快捷工具栏。
 *
 * 与节点快捷工具栏（QuickNodeToolbar）保持同一套视觉语言，只放与"连线外观"相关的控件：
 * 颜色 + 格式刷 + 样式设置（展开面板）+ 复位 + 删除。位置由 EdgeLabelRenderer 负责。
 * 删除按钮放在最右、用危险色 hover 区别于其它按钮，但沿用同样的圆角与尺寸。
 *
 * 样式面板以 absolute 挂在工具栏下方，不改变工具栏自身尺寸——外层 EdgeToolbarAnchor
 * 用 ResizeObserver 量尺寸做避让，若面板撑宽工具栏会让整个浮层位置跳动。
 */
function QuickEdgeToolbar({
  edgeStyle,
  isFormatPainterActive,
  hasCustomAnchors,
  hasCustomCurve,
  onStyleChange,
  onToggleFormatPainter,
  onResetAnchors,
  onResetCurve,
  onDelete,
}: QuickEdgeToolbarProps) {
  const [stylePanelOpen, setStylePanelOpen] = useState(false)

  // Esc 收起面板；点击画布空白处会取消选中、浮层整体卸载，面板随之关闭
  useEffect(() => {
    if (!stylePanelOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStylePanelOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [stylePanelOpen])

  return (
    <div
      className="nodrag nopan relative flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1.5 shadow-[var(--shadow-popover)]"
      style={{ pointerEvents: 'all' }}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onDoubleClick={stopEvent}
    >
      <div
        className="relative flex h-7 w-7 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)] transition-all duration-200 cursor-pointer"
        title="更改线条颜色"
      >
        <div
          className="h-3.5 w-3.5 rounded-full border-[1.5px] border-[var(--color-surface)] shadow-sm z-10"
          style={{ backgroundColor: edgeStyle.color || 'var(--color-surface)' }}
        />
        <input
          type="color"
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-20"
          value={edgeStyle.color || 'var(--color-surface)'}
          onChange={(event) => onStyleChange({ color: event.target.value })}
        />
      </div>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border-light)]" />

      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
          isFormatPainterActive
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
        )}
        onClick={onToggleFormatPainter}
        title={isFormatPainterActive ? "取消格式刷 (Esc)" : "格式刷"}
      >
        <PaintRoller className="h-4 w-4" strokeWidth={isFormatPainterActive ? 2.5 : 2} />
      </button>

      <button
        type="button"
        aria-expanded={stylePanelOpen}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
          stylePanelOpen
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
        )}
        onClick={() => setStylePanelOpen((open) => !open)}
        title={stylePanelOpen ? "收起样式设置" : "样式设置（线型 / 线条 / 粗细 / 颜色）"}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
      </button>

      {hasCustomAnchors && (
        <>
          <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border-light)]" />
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] transition-all duration-200"
            onClick={onResetAnchors}
            title="恢复自动锚点（两端）"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
          </button>
        </>
      )}

      {hasCustomCurve && (
        <>
          <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border-light)]" />
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] transition-all duration-200"
            onClick={onResetCurve}
            title="复位弯曲（恢复成直线）"
          >
            <Spline className="h-4 w-4" strokeWidth={2} />
          </button>
        </>
      )}

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border-light)]" />

      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-all duration-200"
        onClick={onDelete}
        title="删除连线"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} />
      </button>

      {stylePanelOpen && (
        <QuickEdgeStylePopover edgeStyle={edgeStyle} onChange={onStyleChange} />
      )}
    </div>
  )
}

export default memo(QuickEdgeToolbar)
