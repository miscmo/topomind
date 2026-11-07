import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DefaultEditorStyle, EditorPaperBackground } from '../../../../domain/style/styleTypes'
import { EDITOR_STYLE_NUMBER_LIMITS, clampNumber } from '../../../../domain/style/styleConstraints'
import { EDGE_COLOR_PRESETS, resolveEditorFontChoice } from '../../../../domain/style/styleDefaults'
import { EDITOR_FONT_OPTIONS, EDITOR_STYLE_PRESETS, PAPER_BACKGROUND_OPTIONS } from '../../../../domain/style/editorStyleOptions'

const POPOVER_WIDTH = 320
const POPOVER_MAX_HEIGHT = 460
const EDGE_MARGIN = 8
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

type NumberFieldKey = 'fontSize' | 'lineHeight' | 'letterSpacing' | 'fontWeight' | 'headingSpacingRatio' | 'blockSpacing'
type ColorFieldKey = 'textColor' | 'backgroundColor'

interface EditorStylePopoverProps {
  rect: { top: number; bottom: number; left: number; right: number }
  editorStyle: DefaultEditorStyle
  onChange: (patch: Partial<DefaultEditorStyle>) => void
  onClose: () => void
}

/** 分组标题。浮层是 portal 到 body 的，样式只用主题变量，浅/深色都能读。 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-2.5 last:mb-0">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)]">{title}</div>
      <div className="flex flex-col gap-[3px]">{children}</div>
    </section>
  )
}

/**
 * 数字项：本地草稿 + 失焦/回车一次提交。
 * 逐字 onChange 就写盘会卡（writeConfig 无 debounce），也容易把「1」这种中间值写进配置。
 */
function NumberRow({
  field,
  label,
  unit,
  value,
  onChange,
}: {
  field: NumberFieldKey
  label: string
  unit?: string
  value: number
  onChange: (patch: Partial<DefaultEditorStyle>) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const limits = EDITOR_STYLE_NUMBER_LIMITS[field]

  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value))
      return
    }
    const next = clampNumber(parsed, limits.min, limits.max)
    setDraft(String(next))
    if (next !== value) onChange({ [field]: next } as Partial<DefaultEditorStyle>)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setDraft(String(value))
      event.currentTarget.blur()
    }
  }

  return (
    <label data-tm-editor-style-field={field} className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
      <span className="shrink-0">{label}{unit && <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">{unit}</span>}</span>
      <input
        type="number"
        aria-label={label}
        min={limits.min}
        max={limits.max}
        step={limits.step ?? 1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="h-6 w-[88px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 text-right text-[12px] tabular-nums text-[var(--color-text-primary)] box-border focus:border-[var(--color-accent)] focus:outline-none"
      />
    </label>
  )
}

/**
 * 颜色项：原生取色器与右栏旧行为一致（change 即提交），hex 文本框走失焦/回车，
 * 色板点击一次提交一次。非法 hex 一律回退到原值，不写脏配置。
 */
function ColorRow({
  field,
  label,
  value,
  onChange,
}: {
  field: ColorFieldKey
  label: string
  value: string
  onChange: (patch: Partial<DefaultEditorStyle>) => void
}) {
  const [draft, setDraft] = useState(value || '')
  useEffect(() => { setDraft(value || '') }, [value])

  const commit = useCallback((next: string) => {
    const color = next.trim()
    if (!HEX_COLOR.test(color)) {
      setDraft(value || '')
      return
    }
    setDraft(color)
    if (color.toLowerCase() !== (value || '').toLowerCase()) {
      onChange({ [field]: color } as Partial<DefaultEditorStyle>)
    }
  }, [field, onChange, value])

  return (
    <div data-tm-editor-style-field={field} className="flex flex-col gap-1.5 py-0.5">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
        <span>{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`${label}取色`}
            value={HEX_COLOR.test(draft) ? draft : '#ffffff'}
            onChange={(event) => commit(event.target.value)}
            className="h-6 w-7 cursor-pointer rounded border border-[var(--color-border-strong)] bg-transparent p-0"
          />
          <input
            aria-label={`${label}色值`}
            value={draft}
            placeholder="#FFFFFF"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
              if (event.key === 'Escape') { setDraft(value || ''); event.currentTarget.blur() }
            }}
            className="h-6 w-[86px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 font-mono text-[11px] uppercase text-[var(--color-text-primary)] box-border focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {EDGE_COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={`${label}设为 ${color}`}
            onClick={() => commit(color)}
            className="h-4 w-4 cursor-pointer rounded border border-black/10 p-0 transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 编辑器样式下拉浮层：右栏「文档编辑器」分区的全部设置都迁到这里。
 * 一律 portal 到 document.body —— 工具栏根容器是 overflow:hidden（折叠 morph 需要），
 * 浮层挂在里面会被裁掉，也会被 ProseMirror 的编辑区层级盖住。
 */
export const EditorStylePopover = memo(function EditorStylePopover({
  rect,
  editorStyle,
  onChange,
  onClose,
}: EditorStylePopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // 点击浮层之外 / Esc 关闭；触发按钮交给它自己 toggle，避免「先关再开」的抖动。
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (rootRef.current?.contains(event.target)) return
      if (event.target.closest('[data-tm-editor-style-trigger]')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  const position = useMemo(() => {
    let top = rect.bottom + 6
    if (top + POPOVER_MAX_HEIGHT + EDGE_MARGIN > window.innerHeight) {
      top = Math.max(EDGE_MARGIN, rect.top - POPOVER_MAX_HEIGHT - 6)
    }
    let left = rect.right - POPOVER_WIDTH
    if (left + POPOVER_WIDTH + EDGE_MARGIN > window.innerWidth) {
      left = window.innerWidth - POPOVER_WIDTH - EDGE_MARGIN
    }
    return { top: Math.max(EDGE_MARGIN, top), left: Math.max(EDGE_MARGIN, left) }
  }, [rect])

  const fontValue = resolveEditorFontChoice(editorStyle.fontFamily)
  const fontKnown = EDITOR_FONT_OPTIONS.some((option) => option.value === fontValue)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={rootRef}
      data-tm-editor-style-popover=""
      role="dialog"
      aria-label="编辑器样式设置"
      className="tm-editor-style-popover fixed z-[10000] flex w-[320px] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
      style={{ top: position.top, left: position.left, maxHeight: POPOVER_MAX_HEIGHT }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-3 py-2">
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">编辑器样式</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">全局生效</span>
      </div>
      <div className="tm-editor-style-popover__body min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <Group title="风格预设">
          <div className="grid grid-cols-3 gap-1.5">
            {EDITOR_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                data-tm-editor-style-preset={preset.label}
                title="一键套用整套样式（含版面宽度）"
                onClick={() => onChange(preset.style)}
                className="h-7 cursor-pointer rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Group>

        <Group title="文字">
          <NumberRow field="fontSize" label="字体大小" unit="px" value={editorStyle.fontSize} onChange={onChange} />
          <label data-tm-editor-style-field="fontFamily" className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <span className="shrink-0">字体</span>
            <select
              aria-label="字体"
              value={fontValue}
              onChange={(event) => onChange({ fontFamily: event.target.value })}
              className="h-6 w-[132px] cursor-pointer rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              {!fontKnown && <option value={fontValue}>自定义</option>}
              {EDITOR_FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <NumberRow field="lineHeight" label="行高" unit="倍" value={editorStyle.lineHeight} onChange={onChange} />
          <NumberRow field="letterSpacing" label="字间距" unit="em" value={editorStyle.letterSpacing} onChange={onChange} />
          <NumberRow field="fontWeight" label="正文粗细" value={editorStyle.fontWeight} onChange={onChange} />
        </Group>

        <Group title="段落">
          <NumberRow field="headingSpacingRatio" label="标题间距" unit="倍" value={editorStyle.headingSpacingRatio} onChange={onChange} />
          <NumberRow field="blockSpacing" label="段落间距" unit="px" value={editorStyle.blockSpacing} onChange={onChange} />
        </Group>

        <Group title="颜色">
          <ColorRow field="textColor" label="文字颜色" value={editorStyle.textColor} onChange={onChange} />
          <ColorRow field="backgroundColor" label="背景颜色" value={editorStyle.backgroundColor} onChange={onChange} />
        </Group>

        <Group title="纸张背景">
          <div data-tm-editor-style-field="paperBackground" className="grid grid-cols-3 gap-1.5">
            {PAPER_BACKGROUND_OPTIONS.map((option) => {
              const active = (editorStyle.paperBackground ?? 'plain') === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  data-tm-editor-style-paper={option.value}
                  aria-pressed={active}
                  onClick={() => onChange({ paperBackground: option.value as EditorPaperBackground })}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border p-1 ${active ? 'border-[var(--color-accent)] bg-[var(--color-selected-bg)]' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:bg-[var(--color-hover-bg)]'}`}
                >
                  <span className={`tm-paper-thumb tm-paper-thumb--${option.value} block h-5 w-full`} />
                  <span className={`text-[11px] ${active ? 'font-medium text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}>{option.label}</span>
                </button>
              )
            })}
          </div>
        </Group>
      </div>
      <div className="shrink-0 border-t border-[var(--color-border-light)] px-3 py-1.5 text-[10px] leading-[1.4] text-[var(--color-text-muted)]">
        内容最大宽度与左右留白在工具栏的「版面」里调整；设置写入工作区配置，对所有文档生效。
      </div>
    </div>,
    document.body,
  )
})
