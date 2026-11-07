import { memo, useEffect, useState } from 'react'
import { Check, Link2, PaintRoller, RotateCcw, SlidersHorizontal, Spline, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EdgeStylePatch } from '../../../../types'
import type { EdgeRelationDefinition } from '../../../../domain/graph/edgeRelations'
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
  /** 全局连线关系定义（内置 4 种 + 自定义） */
  relations: readonly EdgeRelationDefinition[]
  /** 本条连线当前关系 id（旧中文值已在读取侧映射过） */
  currentRelationId: string
  /** 切换关系：会套用该关系的默认样式 */
  onRelationChange: (id: string) => void
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
  relations,
  currentRelationId,
  onRelationChange,
  onToggleFormatPainter,
  onResetAnchors,
  onResetCurve,
  onDelete,
}: QuickEdgeToolbarProps) {
  const [stylePanelOpen, setStylePanelOpen] = useState(false)
  const [relationMenuOpen, setRelationMenuOpen] = useState(false)
  const currentRelationName = relations.find((item) => item.id === currentRelationId)?.name ?? '关联'

  // Esc 收起两个浮层；点击画布空白处会取消选中、浮层整体卸载，面板随之关闭
  useEffect(() => {
    if (!stylePanelOpen && !relationMenuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setStylePanelOpen(false)
      setRelationMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [stylePanelOpen, relationMenuOpen])

  return (
    <div
      className="nodrag nopan relative flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1.5 shadow-[var(--shadow-popover)]"
      style={{ pointerEvents: 'all' }}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onDoubleClick={stopEvent}
    >
      <div className="relative">
        <button
          type="button"
          data-tm-edge-relation-trigger=""
          aria-expanded={relationMenuOpen}
          title="设置连线关系（在右栏「样式 → 连线关系」中新增 / 改名 / 配样式）"
          onClick={() => { setRelationMenuOpen((open) => !open); setStylePanelOpen(false) }}
          className={cn(
            "flex h-7 max-w-[96px] items-center gap-1 rounded-xl px-1.5 text-[11px] transition-all duration-200",
            relationMenuOpen
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
          )}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{currentRelationName}</span>
        </button>

        {relationMenuOpen && (
          <div
            data-tm-edge-relation-menu=""
            className="nodrag nopan absolute left-0 top-full z-[11] mt-2 flex w-[238px] flex-col gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 shadow-[var(--shadow-popover)]"
            style={{ pointerEvents: 'all' }}
          >
            {relations.map((item) => (
              <button
                key={item.id}
                type="button"
                data-tm-edge-relation-item={item.id}
                aria-pressed={item.id === currentRelationId}
                onClick={() => { onRelationChange(item.id); setRelationMenuOpen(false) }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  item.id === currentRelationId
                    ? "bg-[var(--color-selected-bg)]"
                    : "hover:bg-[var(--color-hover-bg)]"
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: item.style.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-[var(--color-text-primary)]">{item.name}</span>
                  {item.description && (
                    <span className="block truncate text-[10px] text-[var(--color-text-muted)]">{item.description}</span>
                  )}
                </span>
                {item.id === currentRelationId && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />}
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--color-border)] pt-1.5 text-[10px] leading-[1.5] text-[var(--color-text-muted)]">
              在右栏「样式 → 连线关系」中新增 / 改名 / 调整每种关系的样式
            </div>
          </div>
        )}
      </div>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border-light)]" />

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
        onClick={() => { setStylePanelOpen((open) => !open); setRelationMenuOpen(false) }}
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
