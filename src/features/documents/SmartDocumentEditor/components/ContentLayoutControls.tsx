import { useCallback, useEffect, useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'
import { EDITOR_STYLE_NUMBER_LIMITS } from '../../../../domain/style/styleConstraints'
import { normalizeEditorLayout, type EditorLayout } from '../editorLayout'

interface ContentLayoutControlsProps {
  /** 当前生效的版面（只传已提交值，绝不回传拖动预览值） */
  layout: EditorLayout
  /** 拖动期间：只改 CSS 预览，不写 store、不落盘 */
  onPreview: (layout: EditorLayout) => void
  /** 松手 / 键盘调整结束 / 失焦：一次性写入全局配置 */
  onCommit: (layout: EditorLayout) => void
  disabled?: boolean
}

const WIDTH_MIN = EDITOR_STYLE_NUMBER_LIMITS.contentWidth.min
const WIDTH_MAX = EDITOR_STYLE_NUMBER_LIMITS.contentWidth.max
const WIDTH_STEP = EDITOR_STYLE_NUMBER_LIMITS.contentWidth.step ?? 20
const MARGIN_MIN = Math.round(EDITOR_STYLE_NUMBER_LIMITS.contentMarginRatio.min * 100)
const MARGIN_MAX = Math.round(EDITOR_STYLE_NUMBER_LIMITS.contentMarginRatio.max * 100)

const rangeClassName = 'h-1 w-16 shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed'

/**
 * 顶部工具栏右半段：内容最大宽度（px）+ 剩余留白的左右分配。
 *
 * 宽度是【上限】而不是固定值：右栏比它宽时铺到上限、两侧留白；
 * 右栏比它窄时内容自动占满右栏，留白归零（右栏缩小时不浪费横向空间）。
 *
 * 写盘没有 debounce，所以拖动必须「草稿 + 一次提交」：
 * onChange 只更新本地草稿并回调预览，pointerup / keyup / blur 才真正写 store + writeConfig。
 */
export function ContentLayoutControls({
  layout,
  onPreview,
  onCommit,
  disabled = false,
}: ContentLayoutControlsProps) {
  const [draft, setDraft] = useState<EditorLayout>(() => normalizeEditorLayout(layout))
  // range 的 onChange 每帧都来，读 ref 计算比在 setState updater 里回调父组件安全
  //（后者会在 React 渲染阶段触发另一个组件的 setState，容易告警）。
  const draftRef = useRef<EditorLayout>(draft)
  const dirtyRef = useRef(false)
  const { maxWidth, marginRatio } = layout

  // 外部配置变化（样式预设等）时同步；拖动期间这两个数值不变，不会覆盖草稿 / 清掉脏标记。
  useEffect(() => {
    const next = normalizeEditorLayout({ maxWidth, marginRatio })
    draftRef.current = next
    dirtyRef.current = false
    setDraft(next)
  }, [maxWidth, marginRatio])

  const handleDraft = useCallback((patch: Partial<EditorLayout>) => {
    const next = normalizeEditorLayout({ ...draftRef.current, ...patch })
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
    onPreview(next)
  }, [onPreview])

  const commit = useCallback(() => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    onCommit(normalizeEditorLayout(draftRef.current))
  }, [onCommit])

  const leftPercent = Math.round(draft.marginRatio * 100)
  const rightPercent = 100 - leftPercent

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--color-border-light)]" />
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
        <MoveHorizontal size={14} strokeWidth={2} aria-hidden="true" />
        版面
      </span>
      <label
        className="flex shrink-0 items-center gap-1.5"
        title="内容最大宽度（px）：右栏比它宽时铺到该上限，右栏比它窄时自动占满、不留白"
      >
        <span>宽度</span>
        <input
          type="range"
          aria-label="内容最大宽度"
          min={WIDTH_MIN}
          max={WIDTH_MAX}
          step={WIDTH_STEP}
          value={draft.maxWidth}
          disabled={disabled}
          className={rangeClassName}
          style={{ accentColor: 'var(--color-accent)' }}
          onChange={(event) => handleDraft({ maxWidth: Number(event.target.value) })}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="w-12 shrink-0 text-right tabular-nums">{draft.maxWidth}px</span>
      </label>
      <label
        className="flex shrink-0 items-center gap-1.5"
        title="剩余留白分给左 / 右的比例，50:50 为居中；右栏比配置宽度窄时没有留白"
      >
        <span>左右</span>
        <input
          type="range"
          aria-label="左右留白分配比例"
          min={MARGIN_MIN}
          max={MARGIN_MAX}
          step={1}
          value={leftPercent}
          disabled={disabled}
          className={rangeClassName}
          style={{ accentColor: 'var(--color-accent)' }}
          onChange={(event) => handleDraft({ marginRatio: Number(event.target.value) / 100 })}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="w-10 shrink-0 text-right tabular-nums">{leftPercent}:{rightPercent}</span>
      </label>
    </div>
  )
}
