import type { CSSProperties, ReactNode } from 'react'

import type { ContextDistributionItem } from './analytics.ts'
import { formatDurationCompact } from './analytics.ts'

export const PANEL_CLASS = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]'

export const MUTED_CLASS = 'text-[var(--color-text-muted)]'

/**
 * 页面统一使用 accent 单色色阶；空记录用中性底色，避免硬编码橙红破坏主题。
 * capacity 是「每格容量」：每日记录传日目标，半小时记录传 1800 秒。
 */
export function heatColorStyle(duration: number, capacity: number): CSSProperties {
  if (duration <= 0) {
    return { backgroundColor: 'var(--color-bg-muted)' }
  }
  const ratio = duration / Math.max(capacity, 1)
  const percent = ratio < 0.25 ? 18 : ratio < 0.5 ? 38 : ratio < 0.75 ? 62 : 92
  return {
    backgroundColor: `color-mix(in srgb, var(--color-accent) ${percent}%, var(--color-surface))`,
  }
}

/** 热力图格子的唯一视觉源：每日记录、当天半小时记录、标题栏速览共用。 */
export const HEAT_CELL_SIZE = 13

export const HEAT_CELL_CLASS = 'rounded-sm border border-[var(--color-border-subtle)]'

export function heatCellStyle(duration: number, capacity: number): CSSProperties {
  return { width: HEAT_CELL_SIZE, height: HEAT_CELL_SIZE, ...heatColorStyle(duration, capacity) }
}

type HeatCellProps = {
  /** 归一化容量：每日格子传日目标，半小时格子传 1800 秒 */
  capacity: number
  duration: number
  label: string
  /** false = 日历里的范围外占位，不响应交互也不上色 */
  active?: boolean
  selected?: boolean
  onSelect?: () => void
  onHover?: (hovering: boolean) => void
  dataProps?: Record<`data-${string}`, string | number>
}

export function HeatCell({
  capacity,
  duration,
  label,
  active = true,
  selected = false,
  onSelect,
  onHover,
  dataProps,
}: HeatCellProps) {
  return (
    <div
      {...dataProps}
      role={active ? 'button' : undefined}
      tabIndex={active ? 0 : -1}
      title={active ? label : undefined}
      aria-label={active ? label : undefined}
      data-tm-heat-cell={active ? '' : undefined}
      className={`rounded-sm transition-colors ${
        active ? 'cursor-pointer border border-[var(--color-border-subtle)]' : 'bg-transparent'
      } ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-surface)]' : ''}`}
      style={active ? heatCellStyle(duration, capacity) : { width: HEAT_CELL_SIZE, height: HEAT_CELL_SIZE }}
      onMouseEnter={() => { if (active) onHover?.(true) }}
      onMouseLeave={() => { if (active) onHover?.(false) }}
      onClick={() => { if (active) onSelect?.() }}
      onKeyDown={(event) => {
        if (!active) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect?.()
        }
      }}
    />
  )
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(ratio * 100)))
  return (
    <div className="h-2 w-full rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
      <div
        className="h-full rounded-full bg-[var(--color-accent)]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function SectionCard({
  title,
  aside,
  testId,
  children,
  className = '',
}: {
  title: string
  aside?: ReactNode
  testId?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${PANEL_CLASS} p-5 ${className}`} data-tm-learning-section={testId ?? ''}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function MetricTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-4 py-3">
      <div className={`text-[11px] ${MUTED_CLASS}`}>{label}</div>
      <div className="mt-1.5 text-[19px] leading-none font-semibold text-[var(--color-text-primary)]">
        {value}
      </div>
      {hint ? <div className={`mt-1.5 text-[11px] ${MUTED_CLASS}`}>{hint}</div> : null}
    </div>
  )
}

/** 分布只保留前 3 项；条形按列内最大值归一，避免与总时长百分比重复表述。 */
export function DistributionCard({
  title,
  items,
  emptyText,
}: {
  title: string
  items: ContextDistributionItem[]
  emptyText: string
}) {
  const displayItems = items.slice(0, 3)
  const maxDuration = Math.max(...displayItems.map((item) => item.duration), 1)

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
      <div className="text-[12px] font-medium">{title}</div>
      {displayItems.length > 0 ? (
        <div className="mt-3 flex flex-col gap-3">
          {displayItems.map((item) => (
            <div key={`${title}-${item.key}`}>
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate" title={item.key}>{item.label}</span>
                <span className={`shrink-0 font-medium ${MUTED_CLASS}`}>
                  {formatDurationCompact(item.duration)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.max(item.duration > 0 ? 8 : 0, Math.round((item.duration / maxDuration) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`mt-3 text-[12px] ${MUTED_CLASS}`}>{emptyText}</div>
      )}
    </div>
  )
}
