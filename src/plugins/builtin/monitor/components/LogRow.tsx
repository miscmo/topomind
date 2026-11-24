
import { formatTimestamp, highlightText } from '@/shared/observability/logFormatting'
import type { LogEntry } from '@/shared/observability/logContract'
import { listCategoryFilters } from '@/shared/observability/eventCatalog'
import { CATEGORY_COLORS, LEVEL_COLORS } from '../constants'

/** v3：类别短标签由事件目录自动生成，不在组件里手写枚举。 */
const CATEGORY_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  listCategoryFilters().map((filter) => [filter.id, filter.shortLabel]),
)

interface LogRowProps {
  entry: LogEntry
  selected: boolean
  onClick: () => void
  keyword: string
}

export function LogRow({ entry, selected, onClick, keyword }: LogRowProps) {
  const level = entry.level || 'INFO'
  const levelColor = LEVEL_COLORS[level] || '#888'
  const category = entry.category || 'internal'

  return (
    <div
      className={`flex items-center px-3 py-1 border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors duration-80 min-w-0 gap-0 hover:bg-[var(--color-hover-bg)] ${selected ? '!bg-[var(--color-selected-bg)] border-l-2 border-l-[var(--color-accent)] !pl-[10px]' : ''} ${
        level === 'ERROR' ? 'bg-[var(--color-danger-soft)] hover:!bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)]' : level === 'WARN' ? 'bg-[var(--color-warning-soft)] hover:!bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)]' : ''
      }`}
      onClick={onClick}
    >
      <span className="w-[90px] min-w-[90px] shrink-0 font-mono text-[11px] text-[var(--color-text-muted)]">{formatTimestamp(entry.timestamp ?? '')}</span>
      <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]" style={{ color: levelColor }}>
        {level.padEnd(5)}
      </span>
      <span
        className="w-[64px] min-w-[64px] shrink-0 font-semibold overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ fontSize: 'var(--font-size-xs)', color: CATEGORY_COLORS[category] }}
        title={category}
      >
        {CATEGORY_SHORT_LABELS[category] ?? category}
      </span>
      <span className="w-[100px] min-w-[80px] shrink-0 text-[11px] font-medium text-[var(--color-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.module || 'Unknown', keyword)}</span>
      <span className="w-[140px] min-w-[100px] shrink-0 text-[11px] text-[var(--color-accent)] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.action || '—', keyword)}</span>
      <span className="flex-1 min-w-0 text-[12px] text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap" title={entry.message || ''}>{highlightText(entry.label || entry.message || '', keyword)}</span>
    </div>
  )
}
