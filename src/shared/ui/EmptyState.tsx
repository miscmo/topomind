import type { ReactNode } from 'react'

import { cn } from '../utils/cn'

export interface EmptyStateProps {
  /** 图标节点（传入时已设定好尺寸语义：sm=16 / md=24 / lg=40）。 */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** 主要补救动作（按钮等），排在描述下方。 */
  action?: ReactNode
  /** sm：列表/下拉内嵌紧凑态；md：面板区域级；lg：页面 hero 级。 */
  size?: 'sm' | 'md' | 'lg'
  /** 虚线边框 + 浅底，用于面板/抽屉中的占位区块。 */
  bordered?: boolean
  className?: string
}

const sizeStyles = {
  sm: {
    root: 'gap-2 px-4 py-5',
    badge: 'h-9 w-9 mb-0.5',
    title: 'text-[13px] font-medium',
    description: 'text-[12px]',
    gapAfterDesc: 'gap-3',
  },
  md: {
    root: 'gap-2.5 px-5 py-10',
    badge: 'h-12 w-12 mb-1',
    title: 'text-[14px] font-semibold',
    description: 'text-[12px]',
    gapAfterDesc: 'gap-3',
  },
  lg: {
    root: 'gap-3 px-6 py-14',
    badge: 'h-20 w-20 mb-2',
    title: 'text-[18px] font-semibold',
    description: 'text-[14px]',
    gapAfterDesc: 'gap-6',
  },
} as const

/**
 * 统一空状态占位。
 *
 * 收敛点：此前各模块自行拼装（字号 11~14px、图标 16~40px、颜色硬编码
 * `#94a3b8` 等），深浅色主题下可读性不一致。现在全部走 token + 三档尺寸。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  bordered = false,
  className,
}: EmptyStateProps) {
  const s = sizeStyles[size]
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center text-[var(--color-text-muted)]',
        s.root,
        bordered &&
          'rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-muted)]',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]',
            s.badge,
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className={cn(s.title, 'text-[var(--color-text-secondary)]')}>{title}</div>
      {description ? (
        <div className={cn(s.description, 'max-w-[420px] leading-relaxed text-[var(--color-text-muted)]')}>
          {description}
        </div>
      ) : null}
      {action ? <div className={cn('flex flex-wrap items-center justify-center', s.gapAfterDesc)}>{action}</div> : null}
    </div>
  )
}
