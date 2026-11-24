import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'

/**
 * 智能文档「手绘流程图」块被点击后，在块上方弹出的对齐浮层。
 *
 * 为什么不复用 ImageAlignToolbar：它只认 image/file/video，且靠
 * `.ProseMirror-selectednode` 判定选中；流程图块是 content:none 的自定义块，
 * 点击落在预览 button / 拖动边框上时选区形态并不稳定。这里改用 document 的
 * click 捕获委托 + editor.getBlock(id)（不依赖 getSelection），把「当前激活的
 * 块 id」存在 ref 里，updateBlock 重建节点视图后仍能按 id 重新找到 DOM。
 *
 * 浮层 portal 到 body 并按块矩形定位；顶部空间不足翻到下方，左右做视口钳制。
 * 全屏编辑层出现时立即隐藏（浮层 z-index 高于全屏层，否则会压在编辑器上）。
 */

const TOOLBAR_HEIGHT = 38
const TOOLBAR_WIDTH = 118
const EDGE_GAP = 8
type AlignValue = 'left' | 'center' | 'right'
type Placement = 'top' | 'bottom'

type ToolbarState = {
  top: number
  left: number
  blockId: string
  alignment: AlignValue
  placement: Placement
}

const ALIGN_ITEMS: { value: AlignValue; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: '左对齐', Icon: AlignLeft },
  { value: 'center', label: '居中对齐', Icon: AlignCenter },
  { value: 'right', label: '右对齐', Icon: AlignRight },
]

export function ExcalidrawBlockToolbar() {
  const editor = useSmartBlockNoteEditor()
  const [state, setState] = useState<ToolbarState | null>(null)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    let raf = 0
    let observedEl: Element | null = null
    let resizeObserver: ResizeObserver | null = null

    const hide = () => {
      if (resizeObserver && observedEl) {
        resizeObserver.unobserve(observedEl)
        observedEl = null
      }
      setState(null)
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const id = activeIdRef.current
        // 全屏编辑期间隐藏，并清掉激活块：退出编辑后不该凭空再弹出浮层。
        if (!id || !editor.isEditable
          || document.querySelector('[data-tm-excalidraw-block-editor]')) {
          activeIdRef.current = null
          hide()
          return
        }
        const block = editor.getBlock(id)
        const el = editor.prosemirrorView?.dom.querySelector<HTMLElement>(
          `[data-tm-excalidraw-block="${CSS.escape(id)}"]`,
        )
        if (!block || block.type !== 'excalidraw' || !el) {
          activeIdRef.current = null
          hide()
          return
        }
        // 拖动边框改变尺寸时，浮层的水平中心也要跟着走。
        if (resizeObserver && el !== observedEl) {
          if (observedEl) resizeObserver.unobserve(observedEl)
          resizeObserver.observe(el)
          observedEl = el
        }
        const raw = (block.props as Record<string, unknown>)?.textAlignment
        const alignment: AlignValue = raw === 'center' || raw === 'right' ? raw : 'left'
        const rect = el.getBoundingClientRect()
        const topCandidate = rect.top - TOOLBAR_HEIGHT - EDGE_GAP
        const placement: Placement = topCandidate >= EDGE_GAP ? 'top' : 'bottom'
        const top = placement === 'top' ? topCandidate : rect.bottom + EDGE_GAP
        const centerX = rect.left + rect.width / 2
        const maxLeft = Math.max(EDGE_GAP, window.innerWidth - TOOLBAR_WIDTH - EDGE_GAP)
        const left = Math.max(EDGE_GAP, Math.min(centerX - TOOLBAR_WIDTH / 2, maxLeft))
        // 值没变就复用旧对象，避免滚动 / onChange 高频触发无意义重渲染。
        setState((prev) => (
          prev && prev.top === top && prev.left === left && prev.blockId === id
            && prev.alignment === alignment && prev.placement === placement
            ? prev
            : { top, left, blockId: id, alignment, placement }
        ))
      })
    }

    resizeObserver = new ResizeObserver(() => schedule())

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 工具栏按钮自身的点击不改激活态；updateBlock 后的 onChange 会重算高亮。
      if (target.closest('[data-tm-excalidraw-block-toolbar]')) return
      // 拖完边框松手时浏览器还会补一个 click，别把浮层关掉。
      if (target.closest('[data-tm-excalidraw-block-resize]')) return
      const blockEl = target.closest<HTMLElement>('.tm-excalidraw-block[data-tm-excalidraw-block]')
      const id = blockEl?.getAttribute('data-tm-excalidraw-block') ?? null
      if (id && editor.isEditable) {
        activeIdRef.current = id
        schedule()
      } else {
        activeIdRef.current = null
        hide()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      activeIdRef.current = null
      hide()
    }
    // 只盯全屏编辑层的挂载 / 卸载：body 下其它浮层（含本工具栏）增删不能触发，
    // 否则 setState → portal 子节点变化 → 再 setState 会形成自激循环。
    const bodyObserver = new MutationObserver((records) => {
      for (const record of records) {
        const nodes = [...record.addedNodes, ...record.removedNodes]
        if (nodes.some((node) => node instanceof Element
          && (node.matches('[data-tm-excalidraw-block-editor]')
            || node.querySelector('[data-tm-excalidraw-block-editor]')))) {
          schedule()
          return
        }
      }
    })

    document.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    bodyObserver.observe(document.body, { childList: true })
    const unsubChange = editor.onChange?.(schedule)
    const unsubSelection = editor.onSelectionChange?.(schedule)
    // 首帧：打开文档时若块已被选中，也能补上浮层定位。
    schedule()

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      bodyObserver.disconnect()
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (typeof unsubChange === 'function') unsubChange()
      if (typeof unsubSelection === 'function') unsubSelection()
    }
  }, [editor])

  const handleAlign = useCallback((value: AlignValue) => {
    if (!state) return
    const block = editor.getBlock(state.blockId)
    if (!block) return
    editor.updateBlock(block, { props: { textAlignment: value } })
    // updateBlock 会触发 onChange → schedule；这里同步一次让按钮立即高亮。
    setState((prev) => (prev && prev.blockId === state.blockId ? { ...prev, alignment: value } : prev))
  }, [editor, state])

  if (!state) return null

  return createPortal(
    <div
      data-tm-excalidraw-block-toolbar={state.placement}
      onMouseDown={(event) => event.preventDefault()}
      className="tm-excalidraw-block-toolbar tm-popover-enter"
      style={{ position: 'fixed', top: state.top, left: state.left }}
      role="toolbar"
      aria-label="流程图块对齐"
    >
      {ALIGN_ITEMS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="tm-excalidraw-block-toolbar__btn"
          data-kind={value}
          data-tm-excalidraw-align-value={value}
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
