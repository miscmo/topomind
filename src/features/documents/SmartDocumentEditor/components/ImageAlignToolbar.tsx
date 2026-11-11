import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { NodeSelection } from '@tiptap/pm/state'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'

/**
 * 图片 / 文件 / 视频等「媒体块」被整块选中（NodeSelection）时，在块上方弹出对齐浮层。
 *
 * 为什么要自己实现：当前 BlockNote 版本的 `FormattingToolbarExtension` 在媒体块被
 * NodeSelection 选中、且 `doc.textBetween(from,to)` 长度为 0 时，会强制把格式化工具条
 * 的 open 状态置为 false（见 `@blocknote/core` 的 `FormattingToolbar.ts` 里的 `r()`）。
 * 这导致旧版「点图片 → 上方弹出对齐工具条」的能力在当前版本丢失——即便我们在自定义
 * 格式化工具条里加了对齐按钮也不会渲染（控制器根本不 open）。
 *
 * 因此这里绕开 BlockNote 的 open 判定，自己监听 selection / 滚动 / 缩放，用 fixed 浮层
 * 把对齐按钮定位到媒体块上方，点击直接 `updateBlock(textAlignment)` 驱动图片对齐。
 */

const MEDIA_BLOCK_TYPES = new Set(['image', 'file', 'video'])
type AlignValue = 'left' | 'center' | 'right'

type ToolbarState = {
  top: number
  left: number
  blockId: string
  alignment: AlignValue
}

function AlignButton({
  value,
  active,
  onClick,
}: {
  value: AlignValue
  active: boolean
  onClick: (v: AlignValue) => void
}) {
  const Icon = value === 'left' ? AlignLeft : value === 'center' ? AlignCenter : AlignRight
  const label = value === 'left' ? '左对齐' : value === 'center' ? '居中' : '右对齐'
  const className = active
    ? 'tm-image-align-btn flex h-7 w-7 items-center justify-center rounded bg-[var(--color-accent)] text-white transition-colors'
    : 'tm-image-align-btn flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover-bg)]'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tm-image-align-value={value}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onClick(value)}
      className={className}
    >
      <Icon size={16} />
    </button>
  )
}

export function ImageAlignToolbar() {
  const editor = useSmartBlockNoteEditor()
  const [state, setState] = useState<ToolbarState | null>(null)

  useEffect(() => {
    let raf = 0
    const compute = () => {
      const view = editor.prosemirrorView
      if (!view) {
        setState(null)
        return
      }
      const sel = view.state.selection
      // 只对「媒体块整块选中」弹出，文字选区留给右侧自定义格式化工具条处理。
      if (!(sel instanceof NodeSelection)) {
        setState(null)
        return
      }
      const node = sel.node
      if (!MEDIA_BLOCK_TYPES.has(node.type.name)) {
        setState(null)
        return
      }
      const dom = view.nodeDOM(sel.from) as HTMLElement | null
      if (!dom || typeof dom.getBoundingClientRect !== 'function') {
        setState(null)
        return
      }
      const rect = dom.getBoundingClientRect()
      const block = editor.getSelection()?.blocks?.[0]
      if (!block) {
        setState(null)
        return
      }
      const raw = (block.props as Record<string, unknown>)?.textAlignment
      const alignment: AlignValue = raw === 'center' || raw === 'right' ? (raw as AlignValue) : 'left'
      setState({ top: rect.top, left: rect.left, blockId: block.id, alignment })
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }

    const unsubSelection = editor.onSelectionChange?.(schedule)
    const unsubChange = editor.onChange?.(schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      cancelAnimationFrame(raf)
      if (typeof unsubSelection === 'function') unsubSelection()
      if (typeof unsubChange === 'function') unsubChange()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [editor])

  const handleAlign = useCallback(
    (value: AlignValue) => {
      if (!state) return
      const block = editor.getSelection()?.blocks?.find((b) => b.id === state.blockId)
      if (block) {
        editor.updateBlock(block, { props: { textAlignment: value } })
      }
    },
    [editor, state],
  )

  if (!state) return null

  return createPortal(
    <div
      data-tm-image-align-toolbar=""
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: Math.max(8, state.top - 44),
        left: state.left,
        zIndex: 1200,
      }}
      className="tm-image-align-toolbar flex items-center gap-1 rounded-md border border-[var(--color-border-light)] bg-[var(--color-surface)] p-1 shadow-md"
    >
      <AlignButton value="left" active={state.alignment === 'left'} onClick={handleAlign} />
      <AlignButton value="center" active={state.alignment === 'center'} onClick={handleAlign} />
      <AlignButton value="right" active={state.alignment === 'right'} onClick={handleAlign} />
    </div>,
    document.body,
  )
}
