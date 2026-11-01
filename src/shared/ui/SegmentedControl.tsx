import type { ReactNode } from 'react'

import { cn } from '../utils/cn'

export interface SegmentedOption<T extends string | number | boolean> {
  label: ReactNode
  value: T
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string | number | boolean> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** sm：标题栏等紧凑区；md：面板/表单区。 */
  size?: 'sm' | 'md'
  /** 每项是否等分容器宽度（默认 true）。false 时按内容宽度排布。 */
  grow?: boolean
  fullWidth?: boolean
  ariaLabel?: string
  className?: string
}

const containerStyles = {
  sm: 'h-6 rounded-md p-[2px]',
  md: 'h-8 rounded-md p-[2px]',
} as const

const itemStyles = {
  sm: 'px-2.5 text-[11px]',
  md: 'px-3 text-[12px]',
} as const

/**
 * 统一分段控件（互斥单选）。
 *
 * 收敛点：此前有三套各行其是的写法（容器圆角 12/8/6px、字号 12/11px、
 * 选中态阴影硬编码 `rgba(0,0,0,0.1)`），现在统一走 token + 两档尺寸。
 */
export function SegmentedControl<T extends string | number | boolean>({
  options,
  value,
  onChange,
  size = 'md',
  grow = true,
  fullWidth = true,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0 bg-[var(--color-bg-muted)]',
        containerStyles[size],
        fullWidth && 'w-full box-border',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-full inline-flex items-center justify-center gap-1 rounded-sm border-none font-medium cursor-pointer select-none text-center transition-colors duration-75',
              itemStyles[size],
              grow && 'flex-1 min-w-0',
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]',
              opt.disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
