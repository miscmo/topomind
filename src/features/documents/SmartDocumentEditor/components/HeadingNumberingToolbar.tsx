import { ListOrdered } from 'lucide-react'

import {
  HEADING_NUMBERING_DEPTH_MAX,
  HEADING_NUMBERING_DEPTH_MIN,
  HEADING_NUMBERING_STYLE_OPTIONS,
  type HeadingNumberingConfig,
  type HeadingNumberingStyle,
} from '../headingNumbering'

interface HeadingNumberingToolbarProps {
  config: HeadingNumberingConfig
  onChange: (patch: Partial<HeadingNumberingConfig>) => void
  disabled?: boolean
}

/** 顶部工具栏左半段：标题编号开关 / 样式 / 深度。改的是文档级配置，不动正文 blocks。 */
export function HeadingNumberingToolbar({
  config,
  onChange,
  disabled = false,
}: HeadingNumberingToolbarProps) {
  const selectClassName = 'h-6 min-w-0 max-w-[190px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-[12px] text-[var(--color-text-primary)] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed'
  const settingsDisabled = disabled || !config.enabled

  return (
    <>
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
        <ListOrdered size={14} strokeWidth={2} aria-hidden="true" />
        标题编号
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        aria-label="自动编号"
        title={config.enabled ? '关闭自动编号' : '开启自动编号'}
        disabled={disabled}
        onClick={() => onChange({ enabled: !config.enabled })}
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-[var(--color-border-strong)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: config.enabled ? 'var(--color-primary)' : 'var(--color-bg-muted)' }}
      >
        <span
          aria-hidden="true"
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-[var(--color-surface)] transition-all duration-150"
          style={{ left: config.enabled ? 16 : 2 }}
        />
      </button>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--color-border-light)]" />
      <label className="flex min-w-0 items-center gap-1.5">
        样式
        <select
          className={selectClassName}
          value={config.style}
          disabled={settingsDisabled}
          onChange={(event) => onChange({ style: event.target.value as HeadingNumberingStyle })}
        >
          {HEADING_NUMBERING_STYLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.preview}
            </option>
          ))}
        </select>
      </label>
      <label className="flex shrink-0 items-center gap-1.5">
        深度
        <select
          className={selectClassName}
          value={config.depth}
          disabled={settingsDisabled}
          onChange={(event) => onChange({ depth: Number(event.target.value) })}
        >
          {Array.from(
            { length: HEADING_NUMBERING_DEPTH_MAX - HEADING_NUMBERING_DEPTH_MIN + 1 },
            (_, index) => HEADING_NUMBERING_DEPTH_MIN + index,
          ).map((depth) => (
            <option key={depth} value={depth}>
              至 {depth} 级
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
