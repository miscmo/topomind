/**
 * 面板内列表的唯一视觉语言（与左侧「节点结构」面板保持同一套语言）。
 *
 * 只提供 class 常量和一个操作按钮，不持有任何状态或业务数据：
 * 右侧「文档 / 关联文档 / 附件 / 引用关系」四个列表共用，避免各自漂移。
 * 颜色一律走 tokens.css，深浅色主题都可读；不使用 emoji 或硬编码色值。
 */
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export const PANEL_LIST = {
  /** 分区标题条：图标 + 标题 + 计数 / 说明 + 右侧操作。 */
  header: 'flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-3',
  headerIcon: 'h-4 w-4 shrink-0 text-[var(--color-accent)]',
  title: 'shrink-0 text-[13px] font-medium text-[var(--color-text-primary)]',
  count: 'shrink-0 text-[11px] tabular-nums text-[var(--color-text-muted)]',
  hint: 'min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-muted)]',
  /** 列表滚动区；文档树另有吸顶层（top-[-8px]），它保留自己的 padding 不套用本常量。 */
  body: 'min-h-0 flex-1 overflow-y-auto px-1.5 py-2',
  /** 单行 / 双行条目通用底板；选中态用 inset 竖条，不改变布局与缩进。 */
  row: 'group relative flex min-h-[26px] items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-[var(--color-hover-bg)]',
  rowActive: 'bg-[var(--color-accent-soft)] shadow-[inset_2px_0_0_var(--color-accent)]',
  rowDisabled: 'opacity-60',
  rowTitle: 'min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-primary)]',
  rowTitleActive: 'font-medium text-[var(--color-accent)]',
  rowMeta: 'block truncate text-[10px] text-[var(--color-text-muted)]',
  /** 状态 / 来源徽章，只出现在第二行，不抢标题行的文本匹配。 */
  badge: 'shrink-0 rounded border border-[var(--color-border-light)] px-1 text-[10px] text-[var(--color-text-secondary)]',
  badgeAccent: 'text-[var(--color-accent)]',
  badgeWarning: 'text-[var(--color-warning)]',
  badgeDanger: 'text-[var(--color-danger)]',
  icon: 'h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]',
  iconActive: 'h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]',
  /** 底部一行轻量提示，与左侧节点树面板同款。 */
  footer: 'flex h-7 shrink-0 items-center gap-1 border-t border-[var(--color-border-light)] px-3 text-[10px] text-[var(--color-text-muted)]',
  empty: 'px-3 py-6 text-center text-[11px] text-[var(--color-text-muted)]',
  /** 标题条右侧的主操作（添加 / 上传），保持可点面积 24px。 */
  addButton: 'ml-auto flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] text-[var(--color-accent)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50',
} as const

/** 行内 hover 才出现的图标按钮；title 同时是 GUI 的稳定选择器，勿省略。 */
export function PanelListAction({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border-none bg-transparent text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}
