import { memo } from 'react'
import { PaintRoller, RotateCcw, Spline, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickEdgeToolbarProps {
  /** 当前线条颜色（用于色块预览） */
  color: string
  isFormatPainterActive: boolean
  /** 本条连线是否设置了自定义锚点（决定要不要显示复位按钮） */
  hasCustomAnchors: boolean
  /** 本条曲线是否偏离默认直线（决定要不要显示复位弯曲按钮） */
  hasCustomCurve: boolean
  onColorChange: (value: string) => void
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
 * 与节点快捷工具栏（QuickNodeToolbar）保持同一套视觉语言，但只放与"连线外观"相关的控件：
 * 线条颜色 + 格式刷。位置由 EdgeLabelRenderer 负责（传入的 transform 已居中到连线中点）。
 * 删除按钮放在最右、用危险色 hover 区别于其它按钮，但沿用同样的圆角与尺寸。
 */
function QuickEdgeToolbar({
  color,
  isFormatPainterActive,
  hasCustomAnchors,
  hasCustomCurve,
  onColorChange,
  onToggleFormatPainter,
  onResetAnchors,
  onResetCurve,
  onDelete,
}: QuickEdgeToolbarProps) {
  return (
    <div
      className="nodrag nopan flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1.5 shadow-[var(--shadow-popover)]"
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
          style={{ backgroundColor: color || 'var(--color-surface)' }}
        />
        <input
          type="color"
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-20"
          value={color || 'var(--color-surface)'}
          onChange={(event) => onColorChange(event.target.value)}
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
    </div>
  )
}

export default memo(QuickEdgeToolbar)
