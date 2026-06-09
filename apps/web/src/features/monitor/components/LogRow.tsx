import React from 'react'
import { LEVEL_COLORS } from '../constants'
import { formatTimestamp, highlightText } from '../utils/formatters'

interface LogRowProps {
  entry: { id?: string; timestamp: string; level: string; module?: string; action?: string; message: string; params?: unknown }
  selected: boolean
  onClick: () => void
  keyword: string
}

export function LogRow({ entry, selected, onClick, keyword }: LogRowProps) {
  const level = entry.level || 'INFO'
  const levelColor = LEVEL_COLORS[level] || '#888'

  return (
    <div
      className={`flex items-center px-3 py-1 border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors duration-80 min-w-0 gap-0 hover:bg-[var(--color-hover-bg)] ${selected ? '!bg-[var(--color-selected-bg)] border-l-2 border-l-[var(--color-primary)] !pl-[10px]' : ''} ${
        level === 'ERROR' ? 'bg-[var(--color-danger-soft)] hover:!bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)]' : level === 'WARN' ? 'bg-[var(--color-warning-soft)] hover:!bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)]' : ''
      }`}
      onClick={onClick}
    >
      <span className="w-[90px] min-w-[90px] shrink-0 font-mono text-[11px] text-[var(--color-text-muted)]">{formatTimestamp(entry.timestamp)}</span>
      <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]" style={{ color: levelColor }}>
        {level.padEnd(5)}
      </span>
      <span className="w-[100px] min-w-[80px] shrink-0 text-[11px] font-medium text-[var(--color-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.module || 'Unknown', keyword)}</span>
      <span className="w-[140px] min-w-[100px] shrink-0 text-[11px] text-[var(--color-accent)] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.action || '—', keyword)}</span>
      <span className="flex-1 min-w-0 text-[12px] text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.message || '', keyword)}</span>
    </div>
  )
}
