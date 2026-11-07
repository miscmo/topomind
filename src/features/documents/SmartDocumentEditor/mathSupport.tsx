import type { BlockIdentifier } from '@blocknote/core'
import { createExtension } from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
import { Extension, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { quoteEnterPayload, shouldHandleQuoteEnter } from './quoteEnter'
import { beginMathEditing, endMathEditing } from './mathEditSession'
import { renderMathToHtml } from './mathRender'

type InlineMathRenderProps = {
  inlineContent: {
    props: {
      latex?: string
    }
  }
  updateInlineContent: (update: {
    type: 'inlineMath'
    props: {
      latex: string
    }
  }) => void
  editor: {
    isEditable: boolean
    focus: () => void
  }
  contentRef: (node: HTMLElement | null) => void
}

/** 编辑器内部 ProseMirror 视图的最小可用形状（避免把整个 editor 标成 any）。 */
type PmViewLike = {
  state: EditorState
  dispatch: (tr: Transaction) => void
  posAtDOM: (dom: Node, offset: number, bias?: number) => number
}

function resolvePmView(editor: unknown): PmViewLike | null {
  const view = (editor as { _tiptapEditor?: { view?: PmViewLike } } | null | undefined)?._tiptapEditor?.view
  return view ?? null
}

function inlineContentToPlainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content.map((item) => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    if ('text' in item && typeof item.text === 'string') return item.text
    if ('type' in item && item.type === 'inlineMath' && 'props' in item && item.props && typeof item.props === 'object' && 'latex' in item.props && typeof item.props.latex === 'string') {
      return item.props.latex
    }
    return ''
  }).join('')
}

function focusAndSelectInput(input: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!input) return
  input.focus()
  input.select()
}

function InlineMathRenderer(props: InlineMathRenderProps) {
  const latex = props.inlineContent.props.latex || ''
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(latex)
  const inputRef = useRef<HTMLInputElement>(null)
  const shellRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    setDraft(latex)
  }, [latex])

  // 编辑期间挂上「正在编辑公式」信号，让块时间戳写入推迟到编辑结束之后。
  // 否则那次写入会重建节点视图，输入框连同草稿一起消失。
  useEffect(() => {
    if (!isEditing) return
    beginMathEditing()
    return () => endMathEditing()
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) return
    const frame = window.requestAnimationFrame(() => focusAndSelectInput(inputRef.current))
    return () => window.cancelAnimationFrame(frame)
  }, [isEditing])

  const previewHtml = useMemo(() => renderMathToHtml(latex, false), [latex])

  /**
   * 把光标放到本公式节点之后。
   *
   * 点击公式时我们在捕获阶段拦下了事件，ProseMirror 不会自己更新选区；
   * 而编辑期间又不写文档，选区会一直停在「上次点过的地方」（常常是块首）。
   * 提交后 `editor.focus()` 恢复的就是那个旧选区，接着敲字会写进错误的位置
   * （甚至替换掉一段被选中的文字）。所以进入编辑时先把光标归位。
   */
  const placeCursorAfterMath = useCallback(() => {
    const view = resolvePmView(props.editor)
    const dom = shellRef.current?.closest('[data-inline-content-type="inlineMath"]') ?? shellRef.current
    if (!view || !dom) return
    try {
      const pos = view.posAtDOM(dom, 0)
      if (typeof pos !== 'number') return
      const nodeAfter = view.state.doc.resolve(pos).nodeAfter
      const after = nodeAfter ? pos + nodeAfter.nodeSize : pos
      const selection = TextSelection.create(view.state.doc, after)
      if (selection.eq(view.state.selection)) return
      view.dispatch(view.state.tr.setSelection(selection))
    } catch {
      // 位置解析失败不影响编辑，只是光标不归位
    }
  }, [props.editor])

  const startEditing = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (!props.editor.isEditable) return
    // 必须在捕获阶段拦下：ProseMirror 的监听器挂在编辑器根节点上，冒泡阶段
    // 到达 React 时它已经处理完这次点击（改写选区 → 触发节点视图重建 →
    // 刚设的编辑态立刻丢失，表现为「点了没反应」或「闪一下就没了」）。
    event.preventDefault()
    event.stopPropagation()
    placeCursorAfterMath()
    setDraft(latex)
    setIsEditing(true)
  }

  /**
   * 结束编辑。草稿只在此时一次性写入文档：编辑中途每敲一个字符就写一次，
   * 会让 lastModified 的时间戳写入被反复触发，进而反复重建节点视图。
   */
  const commit = (nextLatex: string, restoreFocus: boolean) => {
    setIsEditing(false)
    if (nextLatex !== latex) {
      props.updateInlineContent({
        type: 'inlineMath',
        props: {
          latex: nextLatex,
        },
      })
    }
    // 失焦提交（用户点到了别处）时不抢焦点；Enter / Esc 提交则把光标还给编辑器
    if (restoreFocus) {
      props.editor.focus()
    }
  }

  return (
    <span
      ref={(node) => {
        shellRef.current = node
        props.contentRef(node)
      }}
      className="tm-inline-math-shell"
    >
      {isEditing && props.editor.isEditable ? (
        <input
          ref={inputRef}
          className="tm-inline-math-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft, false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft, true)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              commit(latex, true)
            }
          }}
          placeholder="输入 LaTeX 公式"
        />
      ) : (
        <span
          className="tm-inline-math-chip"
          onMouseDownCapture={startEditing}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </span>
  )
}

/** createReactBlockSpec 的 render props 是泛型对象，这里只声明本组件实际用到的字段。 */
interface MathBlockRenderProps {
  block: {
    id: string
    props: {
      expression?: string
      textAlignment?: 'left' | 'center' | 'right' | 'justify'
      autoEdit?: boolean
    }
  }
  editor: {
    document: { id: string }[]
    isEditable: boolean
    updateBlock: (block: unknown, update: unknown) => unknown
    setTextCursorPosition: (block: unknown, placement: 'start') => unknown
    insertBlocks: (blocks: { type: string }[], referenceBlock: unknown, placement: 'after') => { id: string }[]
    focus: () => void
  }
}

function MathBlockRenderer(rawProps: unknown) {
  const props = rawProps as MathBlockRenderProps
  const expression = props.block.props.expression || ''
  const textAlignment = props.block.props.textAlignment || 'left'
  const [isEditing, setIsEditing] = useState(Boolean(props.block.props.autoEdit))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewHtml = useMemo(() => renderMathToHtml(expression, true), [expression])

  useEffect(() => {
    if (!props.block.props.autoEdit) return
    setIsEditing(true)
    const frame = window.requestAnimationFrame(() => {
      focusAndSelectInput(textareaRef.current)
      props.editor.updateBlock(props.block, {
        type: 'math',
        props: {
          expression,
          autoEdit: false,
        },
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [expression, props.block, props.block.props.autoEdit, props.editor])

  useEffect(() => {
    if (!isEditing) return
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement !== textareaRef.current) {
        textareaRef.current?.focus()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isEditing])

  // 同行内公式：编辑期间推迟块时间戳写入，避免节点视图重建打断输入
  useEffect(() => {
    if (!isEditing) return
    beginMathEditing()
    return () => endMathEditing()
  }, [isEditing])

  const moveCursorAfterMathBlock = () => {
    const currentIndex = props.editor.document.findIndex((item: { id: string }) => item.id === props.block.id)
    const nextBlock = currentIndex >= 0 ? props.editor.document[currentIndex + 1] : undefined

    if (nextBlock) {
      props.editor.setTextCursorPosition(nextBlock, 'start')
      props.editor.focus()
      return
    }

    const insertedBlock = props.editor.insertBlocks([{ type: 'paragraph' }], props.block, 'after')[0]
    if (insertedBlock) {
      props.editor.setTextCursorPosition(insertedBlock, 'start')
      props.editor.focus()
    }
  }

  return (
    <div
      className={`tm-math-block${isEditing ? ' tm-math-block--editing' : ''}`}
      data-text-alignment={textAlignment}
      style={{ textAlign: textAlignment }}
    >
      <button
        type="button"
        className="tm-math-block-preview"
        onMouseDown={(event) => {
          if (!props.editor.isEditable) return
          event.preventDefault()
          setIsEditing(true)
        }}
      >
        {expression ? (
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <span className="tm-math-block-placeholder">输入块级 LaTeX 公式</span>
        )}
      </button>
      {isEditing && props.editor.isEditable ? (
        <textarea
          ref={textareaRef}
          className="tm-math-block-input bn-editor-input"
          rows={3}
          value={expression}
          onChange={(event) => {
            const nextExpression = event.target.value

            if (/\n\$\$$/.test(nextExpression)) {
              const normalizedExpression = nextExpression.replace(/\n\$\$$/, '')
              props.editor.updateBlock(props.block, {
                type: 'math',
                props: {
                  expression: normalizedExpression,
                  autoEdit: false,
                },
              })
              setIsEditing(false)
              window.requestAnimationFrame(moveCursorAfterMathBlock)
              return
            }

            props.editor.updateBlock(props.block, {
              type: 'math',
              props: {
                expression: nextExpression,
                autoEdit: false,
              },
            })
          }}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setIsEditing(false)
              props.editor.focus()
            }
          }}
          placeholder="输入 LaTeX 公式，末尾输入新行 + $$ 可结束块公式编辑"
        />
      ) : null}
    </div>
  )
}

export const InlineMath = createReactInlineContentSpec(
  {
    type: 'inlineMath',
    propSchema: {
      latex: {
        default: '\\lambda',
      },
    },
    content: 'none',
  },
  {
    render: InlineMathRenderer,
    parse: (element) => {
      const latex = element.getAttribute('data-latex')
      if (!latex) return undefined
      return { latex }
    },
  }
)

export const MathBlock = createReactBlockSpec(
  {
    type: 'math',
    propSchema: {
      expression: {
        default: 'E=mc^2',
      },
      textAlignment: {
        default: 'left',
        values: ['left', 'center', 'right', 'justify'] as const,
      },
      autoEdit: {
        default: false,
      },
    },
    content: 'none',
  },
  {
    render: MathBlockRenderer,
  }
)

export const mathBlockShortcutExtension = createExtension(({ editor }) => ({
  key: 'topomind-math-block-shortcut',
  keyboardShortcuts: {
    Enter: () => {
      const currentBlock = editor.getTextCursorPosition().block as BlockIdentifier & { type?: string; content?: unknown }
      if (currentBlock?.type !== 'paragraph') return false

      const text = inlineContentToPlainText(currentBlock.content).trim()
      if (text !== '$$') return false

      editor.updateBlock(currentBlock, {
        type: 'math',
        props: {
          expression: '',
          autoEdit: true,
        },
      })
      return true
    },
  },
}))
export const quoteEnterExtension = createExtension(({ editor }) => ({
  key: 'topomind-quote-enter',
  keyboardShortcuts: {
    Enter: () => {
      const currentBlock = editor.getTextCursorPosition().block as BlockIdentifier & { type?: string }
      if (!shouldHandleQuoteEnter(currentBlock?.type)) return false
      // Stay inside the quote: insert a line break instead of letting the
      // default handler split the block (which exits the quote).
      editor.insertInlineContent(quoteEnterPayload())
      return true
    },
  },
}))

export const inlineMathInputRuleExtension = Extension.create({
  name: 'topomind-inline-math-input',
  addInputRules() {
    return [
      new InputRule({
        find: /(^|[^$\\])\$([^$\n]+)\$(?!\$)$/,
        handler: ({ state, range, match }) => {
          const inlineMathNode = state.schema.nodes.inlineMath
          if (!inlineMathNode) return null

          const leadingText = typeof match[1] === 'string' ? match[1] : ''
          const latex = typeof match[2] === 'string' ? match[2] : ''
          if (!latex.trim()) return null

          const replacementNodes = []
          if (leadingText) {
            replacementNodes.push(state.schema.text(leadingText))
          }
          replacementNodes.push(inlineMathNode.create({ latex }))

          state.tr.replaceWith(range.from, range.to, replacementNodes)
        },
      }),
    ]
  },
})
