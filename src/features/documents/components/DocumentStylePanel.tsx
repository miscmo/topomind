import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Ban, Bold, Check, FileText, Italic, Palette, Plus, RotateCcw, Smile, Trash2, X } from 'lucide-react'
import type { TopoDocumentMetaPatch } from '../../../core/storage'
import { PANEL_LIST } from '@/shared/ui/panelList'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { EmojiGlyph } from '@/shared/ui/emoji/EmojiGlyph'
import { EmojiPickerPanel } from '@/shared/ui/emoji/EmojiPickerPanel'
import { DOCUMENT_COLOR_INPUT_FALLBACK, DOCUMENT_COLOR_PRESETS, isValidHexColor } from './documentMeta'

/**
 * 文档列表项统一的「编辑样式」面板。
 *
 * 视觉一律复用 controls.css / TM_UI 与 tokens.css 的控件和变量，不在这里手写
 * 圆角、边框、字号、阴影或色值；布局采用成熟属性面板的四段结构：
 *   头部（对象名 + 关闭） → 实时预览 → 扁平分区（图标 / 标题颜色 / 文字） → 固定底栏。
 * 分区之间只用细分割线，避免嵌套卡片造成的"半成品"观感。
 * 只负责取值与回传，portal、定位、外部点击关闭交给 DocumentMetaPicker 外壳。
 */

const FONT_SIZE_PRESETS = [12, 13, 14, 16, 18] as const

/** 原生取色器拖动时 onChange 逐帧触发，写盘合并成一次（预览仍然即时）。 */
const DOCUMENT_COLOR_APPLY_DELAY_MS = 120

interface DocumentStyleDraft {
  icon: string | null
  color: string | null
  fontSize: number | null
  fontWeight: 'normal' | 'bold' | null
  fontStyle: 'normal' | 'italic' | null
}

interface DocumentStylePanelProps {
  title: string
  /** 二级浮层（表情选择器）的定位锚点；优先用「更换图标」按钮的实际位置覆盖 */
  anchor: { x: number; y: number }
  initial: DocumentStyleDraft
  onApply: (patch: TopoDocumentMetaPatch) => void
  onClose: () => void
}

const DEFAULT_DRAFT: DocumentStyleDraft = {
  icon: null,
  color: null,
  fontSize: null,
  fontWeight: null,
  fontStyle: null,
}

/** 扁平分区：标题 + 右侧状态/说明 + 控件，分区间细分割线。 */
function StyleSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border-light)] py-3 last:pb-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[var(--font-size-base)] font-medium text-[var(--color-text-primary)]">{label}</h3>
        {hint && <span className={TM_UI.hint}>{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function DocumentStylePanel({ title, anchor, initial, onApply, onClose }: DocumentStylePanelProps) {
  const [draft, setDraft] = useState<DocumentStyleDraft>(initial)
  const [hexInput, setHexInput] = useState(initial.color ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconAnchor, setIconAnchor] = useState(anchor)

  // 取色器拖动会逐帧触发 onChange：draft 立即更新保证预览即时，但对父组件的
  // 写入合并成一次。用 ref 持有最新 onApply，定时器既不会被父级重渲染重置，
  // 也不会捕获到过期的回调。
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const colorApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingColorRef = useRef<string | null>(null)

  const cancelPendingColor = useCallback(() => {
    if (colorApplyTimerRef.current !== null) {
      clearTimeout(colorApplyTimerRef.current)
      colorApplyTimerRef.current = null
    }
    pendingColorRef.current = null
  }, [])

  const scheduleColorApply = useCallback((color: string) => {
    pendingColorRef.current = color
    if (colorApplyTimerRef.current !== null) clearTimeout(colorApplyTimerRef.current)
    colorApplyTimerRef.current = setTimeout(() => {
      colorApplyTimerRef.current = null
      const pending = pendingColorRef.current
      pendingColorRef.current = null
      if (pending !== null) onApplyRef.current({ color: pending })
    }, DOCUMENT_COLOR_APPLY_DELAY_MS)
  }, [])

  // 面板被关闭时若还有未提交的颜色，补一次写入，避免「拖完立刻关面板」丢改动。
  useEffect(() => () => {
    if (colorApplyTimerRef.current !== null) {
      clearTimeout(colorApplyTimerRef.current)
      colorApplyTimerRef.current = null
    }
    const pending = pendingColorRef.current
    pendingColorRef.current = null
    if (pending !== null) onApplyRef.current({ color: pending })
  }, [])

  const apply = (patch: TopoDocumentMetaPatch, next: Partial<DocumentStyleDraft>) => {
    // 任何非取色器的操作都应覆盖掉尚未提交的取色结果，防止旧颜色回写。
    cancelPendingColor()
    // 面板自身的 draft 立即更新，预览不依赖父组件异步重载 manifest 后才能回显。
    setDraft((prev) => ({ ...prev, ...next }))
    onApply(patch)
  }

  const resetAll = () => {
    cancelPendingColor()
    setDraft(DEFAULT_DRAFT)
    setHexInput('')
    onApply({ icon: null, color: null, fontSize: null, fontWeight: null, fontStyle: null })
  }

  const clearColor = () => {
    setHexInput('')
    apply({ color: null }, { color: null })
  }

  const commitHex = () => {
    const color = hexInput.trim()
    if (isValidHexColor(color)) apply({ color }, { color })
  }

  const nextWeight = draft.fontWeight === 'bold' ? null : 'bold'
  const nextStyle = draft.fontStyle === 'italic' ? null : 'italic'
  const activeColor = draft.color?.toLowerCase() ?? null
  const hexInvalid = hexInput.trim() !== '' && !isValidHexColor(hexInput.trim())
  const pickerColor = draft.color && /^#[0-9a-fA-F]{6}$/.test(draft.color)
    ? draft.color
    : DOCUMENT_COLOR_INPUT_FALLBACK
  // 后端允许 10–24 任意整数字号，历史值不在预设里时也要能显示为选中态。
  const fontSizes = draft.fontSize && !FONT_SIZE_PRESETS.some((size) => size === draft.fontSize)
    ? [...FONT_SIZE_PRESETS, draft.fontSize]
    : FONT_SIZE_PRESETS
  const sizeValue = draft.fontSize ? String(draft.fontSize) : 'default'

  return (
    <div className="flex min-h-0 flex-col" data-tm-document-style-panel="">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--color-border-subtle)] px-3.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Palette className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[var(--font-size-md)] font-medium text-[var(--color-text-primary)]">文档样式</div>
          <div className="truncate text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{title || '未命名文档'}</div>
        </div>
        <button type="button" className={TM_UI.iconButton} onClick={onClose} aria-label="关闭" title="关闭">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className={tmUI(TM_UI.scroll, 'min-h-0 flex-1 overflow-y-auto px-3.5 py-3')}>
        {/* 实时预览：直接模拟列表里的选中行（含选中态常驻的工具按钮），所见即所得 */}
        <div className="mb-1 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-bg)] p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={TM_UI.label}>预览</span>
            <span className={TM_UI.hint}>列表项中的实际效果</span>
          </div>
          <div className={`flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1.5 ${PANEL_LIST.rowActive}`}>
            <span className="h-4 w-4 shrink-0" />
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {draft.icon
                ? <EmojiGlyph char={draft.icon} size={13} />
                : <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
            </span>
            <span
              className="min-w-0 flex-1 truncate"
              style={{
                color: draft.color ?? undefined,
                fontSize: draft.fontSize ?? 12,
                fontWeight: draft.fontWeight ?? undefined,
                fontStyle: draft.fontStyle ?? undefined,
              }}
            >
              {title || '未命名'}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 opacity-40" aria-hidden="true">
              <Plus className="h-3 w-3 text-[var(--color-text-muted)]" />
              <Palette className="h-3 w-3 text-[var(--color-text-muted)]" />
              <Trash2 className="h-3 w-3 text-[var(--color-text-muted)]" />
            </span>
          </div>
        </div>

        <StyleSection label="图标" hint={draft.icon ? '自定义表情' : '跟随文档类型'}>
          <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)]">
              {draft.icon
                ? <EmojiGlyph char={draft.icon} size={16} />
                : <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[var(--font-size-base)] text-[var(--color-text-primary)]">
                {draft.icon ? '自定义表情' : '文档默认图标'}
              </div>
              <div className={TM_UI.hint}>支持中文 / 拼音搜索</div>
            </div>
            <button
              type="button"
              title="更换图标"
              className={TM_UI.button}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setIconAnchor({ x: rect.left, y: rect.bottom + 4 })
                setIconPickerOpen(true)
              }}
            >
              <Smile className="h-3.5 w-3.5" /> 更换图标
            </button>
            {draft.icon && (
              <button
                type="button"
                className={TM_UI.iconButton}
                title="恢复默认图标"
                aria-label="恢复默认图标"
                onClick={() => apply({ icon: null }, { icon: null })}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {iconPickerOpen && (
            <EmojiPickerPanel
              anchor={iconAnchor}
              title="更换图标"
              onClose={() => setIconPickerOpen(false)}
              onRemove={() => {
                apply({ icon: null }, { icon: null })
                setIconPickerOpen(false)
              }}
              removeLabel="恢复默认图标"
              onSelect={(emoji) => {
                apply({ icon: emoji }, { icon: emoji })
                setIconPickerOpen(false)
              }}
            />
          )}
        </StyleSection>

        <StyleSection label="标题颜色" hint={activeColor ? activeColor.toUpperCase() : '跟随主题'}>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              title="恢复默认颜色"
              aria-label="跟随主题"
              aria-pressed={!draft.color}
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer transition-transform hover:scale-110 ${
                !draft.color ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]' : ''
              }`}
              onClick={clearColor}
            >
              <Ban className="h-3 w-3" />
            </button>
            {DOCUMENT_COLOR_PRESETS.map((color) => {
              const active = activeColor === color
              return (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-label={`设置颜色 ${color}`}
                  aria-pressed={active}
                  className={`relative h-[22px] w-[22px] rounded-full border-none cursor-pointer transition-transform hover:scale-110 ${
                    active ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    setHexInput(color)
                    apply({ color }, { color })
                  }}
                >
                  {active && <Check className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-[var(--color-text-inverse)]" />}
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <label
              className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-strong)]"
              style={{ backgroundColor: draft.color || DOCUMENT_COLOR_INPUT_FALLBACK }}
              title="选择自定义颜色"
            >
              <input
                type="color"
                aria-label="选择自定义颜色"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={pickerColor}
                onChange={(event) => {
                  const color = event.target.value
                  setHexInput(color)
                  setDraft((prev) => ({ ...prev, color }))
                  scheduleColorApply(color)
                }}
              />
            </label>
            <input
              type="text"
              value={hexInput}
              onChange={(event) => setHexInput(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitHex()
                if (event.key === 'Escape') setHexInput(draft.color ?? '')
              }}
              placeholder="输入十六进制色值"
              aria-label="自定义十六进制颜色"
              className={tmUI(TM_UI.input, 'min-w-0 flex-1 font-mono uppercase', hexInvalid && '!border-[var(--color-danger)]')}
            />
          </div>
        </StyleSection>

        <StyleSection label="文字" hint="字号 / 字形">
          <div className="mb-2.5">
            <div className={tmUI(TM_UI.label, 'mb-1.5 block')}>字号</div>
            <SegmentedControl
              size="sm"
              ariaLabel="标题字号"
              options={[
                { label: '默认', value: 'default' },
                ...fontSizes.map((size) => ({ label: String(size), value: String(size) })),
              ]}
              value={sizeValue}
              onChange={(value) => {
                const size = value === 'default' ? null : Number(value)
                apply({ fontSize: size }, { fontSize: size })
              }}
            />
          </div>
          <div>
            <div className={tmUI(TM_UI.label, 'mb-1.5 block')}>字形</div>
            <div className="flex gap-2">
              <button
                type="button"
                title="加粗"
                aria-pressed={draft.fontWeight === 'bold'}
                className={tmUI(draft.fontWeight === 'bold' ? TM_UI.buttonActive : TM_UI.button, 'flex-1')}
                onClick={() => apply({ fontWeight: nextWeight }, { fontWeight: nextWeight })}
              >
                <Bold className="h-3.5 w-3.5" /> 加粗
              </button>
              <button
                type="button"
                title="斜体"
                aria-pressed={draft.fontStyle === 'italic'}
                className={tmUI(draft.fontStyle === 'italic' ? TM_UI.buttonActive : TM_UI.button, 'flex-1')}
                onClick={() => apply({ fontStyle: nextStyle }, { fontStyle: nextStyle })}
              >
                <Italic className="h-3.5 w-3.5" /> 斜体
              </button>
            </div>
          </div>
        </StyleSection>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-3.5">
        <span className={TM_UI.hint}>修改即时生效</span>
        <button type="button" className={TM_UI.button} onClick={resetAll}>
          <RotateCcw className="h-3.5 w-3.5" /> 恢复默认样式
        </button>
      </footer>
    </div>
  )
}
