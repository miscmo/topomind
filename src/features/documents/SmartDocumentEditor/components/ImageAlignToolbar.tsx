import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'

/**
 * 图片 / 文件 / 视频等「媒体块」被整块选中时，在块上方弹出对齐浮层。
 *
 * 为什么不复用 BlockNote 自带的格式化工具条对齐按钮：
 * `editor.getSelection()` 的底层实现（core 的 `getSelection()`）会在
 * `selection.empty || "node" in selection` 时直接返回 undefined——媒体块被
 * NodeSelection 整块选中时正好命中后者，导致任何依赖 getSelection() 取当前块的
 * 逻辑都拿不到块，对齐按钮/旧浮层因此从未渲染（只剩一个空的格式化工具条壳）。
 *
 * 这里改为从真实 DOM 事件委托定位媒体块：点击/选区变化时从 `.bn-block-content`
 * 上的 `data-id` 找到块容器，再用 `editor.getBlock(id)` 取块（该 API 不依赖选区
 * 形态），用 `editor.updateBlock(..., textAlignment)` 驱动对齐。
 *
 * 视觉/交互：portal 到 body 的 fixed 浮层，按块的 boundingRect 定位；贴近视口
 * 顶部时自动翻到块下方，左右做边界钳制，保证浮层完整可见。
 */

const MEDIA_BLOCK_TYPES = new Set(['image', 'file', 'video'])
type AlignValue = 'left' | 'center' | 'right'
type Placement = 'top' | 'bottom'

type ToolbarState = {
  top: number
  left: number
  blockId: string
  alignment: AlignValue
  placement: Placement
}

const TOOLBAR_HEIGHT = 38
const TOOLBAR_WIDTH = 118
const EDGE_GAP = 8

const ALIGN_ITEMS: { value: AlignValue; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: '左对齐', Icon: AlignLeft },
  { value: 'center', label: '居中对齐', Icon: AlignCenter },
  { value: 'right', label: '右对齐', Icon: AlignRight },
]

function findMediaBlockContent(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const content = target.closest<HTMLElement>('.bn-block-content[data-content-type]')
  if (!content) return null
  return MEDIA_BLOCK_TYPES.has(content.dataset.contentType ?? '') ? content : null
}

export function ImageAlignToolbar() {
  const editor = useSmartBlockNoteEditor()
  const [state, setState] = useState<ToolbarState | null>(null)

  useEffect(() => {
    let raf = 0

    const compute = (content: HTMLElement) => {
      const blockId = content.closest<HTMLElement>('.bn-block[data-id]')?.getAttribute('data-id')
      if (!blockId) {
        setState(null)
        return
      }
      const block = editor.getBlock(blockId)
      if (!block || !MEDIA_BLOCK_TYPES.has(block.type)) {
        setState(null)
        return
      }
      const raw = (block.props as Record<string, unknown>)?.textAlignment
      const alignment: AlignValue = raw === 'center' || raw === 'right' ? (raw as AlignValue) : 'left'

      // 以「图片本身」而非块容器为锚点：媒体块容器通常横跨整个编辑器宽度，
      // 若按容器左边缘定位，浮层会一直贴在左侧。这里优先取内部 img/video/file
      // 的实际渲染矩形，让浮层水平居中于可见媒体，并锚在它正上方。
      const media =
        content.querySelector<HTMLElement>('img, video, .bn-file-block-content, [data-file-block]') ?? content
      const rect = media.getBoundingClientRect()
      // 顶部空间不足则翻到块下方，避免浮层被视口顶部 / 编辑器顶部工具栏裁切。
      const topCandidate = rect.top - TOOLBAR_HEIGHT - EDGE_GAP
      const placement: Placement = topCandidate >= EDGE_GAP ? 'top' : 'bottom'
      const top = placement === 'top' ? topCandidate : rect.bottom + EDGE_GAP
      // 水平居中于媒体，同时钳制在视口内。
      const centerX = rect.left + rect.width / 2
      const maxLeft = Math.max(EDGE_GAP, window.innerWidth - TOOLBAR_WIDTH - EDGE_GAP)
      const left = Math.max(EDGE_GAP, Math.min(centerX - TOOLBAR_WIDTH / 2, maxLeft))
      setState({ top, left, blockId, alignment, placement })
    }

    const recomputeFromDom = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const view = editor.prosemirrorView
        const selected = view?.dom.querySelector<HTMLElement>(
          '.bn-block-content[data-content-type].ProseMirror-selectednode',
        )
        const content = selected ?? (view?.dom.querySelector<HTMLElement>(
          '.bn-block-content[data-content-type="image"].ProseMirror-selectednode',
        ) ?? null)
        if (content && MEDIA_BLOCK_TYPES.has(content.dataset.contentType ?? '')) {
          compute(content)
        } else {
          setState(null)
        }
      })
    }

    const onClick = (event: MouseEvent) => {
      const content = findMediaBlockContent(event.target)
      if (content) compute(content)
      else recomputeFromDom()
    }
    const onSelectionChange = () => recomputeFromDom()
    const onScrollResize = () => recomputeFromDom()

    const root = editor.prosemirrorView?.dom
    root?.addEventListener('click', onClick, true)
    const unsubSelection = editor.onSelectionChange?.(onSelectionChange)
    const unsubChange = editor.onChange?.(onSelectionChange)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    // 首帧：若打开文档时已经有媒体块处于选中态，也要能显示浮层。
    recomputeFromDom()

    return () => {
      cancelAnimationFrame(raf)
      root?.removeEventListener('click', onClick, true)
      if (typeof unsubSelection === 'function') unsubSelection()
      if (typeof unsubChange === 'function') unsubChange()
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [editor])

  const handleAlign = useCallback(
    (value: AlignValue) => {
      if (!state) return
      const block = editor.getBlock(state.blockId)
      if (!block) return
      editor.updateBlock(block, { props: { textAlignment: value } })
      // updateBlock 触发 onChange → recomputeFromDom，这里直接同步一次让按钮立即高亮。
      setState((prev) => (prev && prev.blockId === state.blockId ? { ...prev, alignment: value } : prev))
    },
    [editor, state],
  )

  if (!state) return null

  return createPortal(
    <div
      data-tm-image-align-toolbar={state.placement}
      onMouseDown={(event) => event.preventDefault()}
      className="tm-image-align-toolbar"
      style={{ position: 'fixed', top: state.top, left: state.left }}
      role="toolbar"
      aria-label="图片对齐"
    >
      {ALIGN_ITEMS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="tm-image-align-toolbar__btn"
          data-kind={value}
          data-tm-image-align-value={value}
          aria-label={label}
          aria-pressed={state.alignment === value}
          title={label}
          onClick={() => handleAlign(value)}
        >
          <Icon size={16} strokeWidth={2} />
        </button>
      ))}
    </div>,
    document.body,
  )
}
