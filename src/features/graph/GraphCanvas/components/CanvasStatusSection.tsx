/**
 * 抽屉内的单个功能区：标题行点击展开 / 折叠，各区状态互相独立。
 *
 * 刻意用 max-height + opacity 折叠而不是条件卸载：面板里的层级诊断、图型说明
 * 等文本是 GUI 回归的数据来源，收起后仍须留在 DOM（textContent 可读）。
 */
import { memo, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { StatusSectionId } from '../model/canvasStatusPreferences'

interface CanvasStatusSectionProps {
  id: StatusSectionId
  title: string
  /** 右侧一行极短的摘要（数量 / 档位），不写长句 */
  badge?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export default memo(function CanvasStatusSection({
  id,
  title,
  badge,
  open,
  onToggle,
  children,
}: CanvasStatusSectionProps) {
  return (
    <section
      data-tm-status-section={id}
      data-tm-status-section-open={open ? 'true' : 'false'}
      className="border-b border-[var(--color-border-light)] last:border-b-0"
    >
      <button
        type="button"
        data-tm-status-section-toggle={id}
        aria-expanded={open}
        title={open ? `折叠${title}` : `展开${title}`}
        onClick={onToggle}
        className="nodrag nowheel flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 opacity-60 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold tracking-wide">{title}</span>
        {badge != null && (
          <span className="ml-auto max-w-[120px] truncate text-[10px] font-normal tabular-nums opacity-70">
            {badge}
          </span>
        )}
      </button>
      <div
        aria-hidden={!open}
        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          open ? 'max-h-[640px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-2.5 pb-2 pt-0.5">{children}</div>
      </div>
    </section>
  )
})
