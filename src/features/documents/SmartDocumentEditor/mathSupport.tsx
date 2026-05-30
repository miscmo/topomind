import type { BlockIdentifier } from '@blocknote/core'
import { createExtension } from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
import { Extension, InputRule } from '@tiptap/core'
import katex from 'katex'
import { useEffect, useMemo, useRef, useState } from 'react'

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

function renderMathToHtml(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex || ' ', {
    displayMode,
    throwOnError: false,
  })
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

  useEffect(() => {
    setDraft(latex)
  }, [latex])

  useEffect(() => {
    if (!isEditing) return
    const frame = window.requestAnimationFrame(() => focusAndSelectInput(inputRef.current))
    return () => window.cancelAnimationFrame(frame)
  }, [isEditing])

  const previewHtml = useMemo(() => renderMathToHtml(latex, false), [latex])

  const handleCommit = () => {
    setIsEditing(false)
    props.editor.focus()
  }

  return (
    <span ref={props.contentRef} className="tm-inline-math-shell">
      {isEditing && props.editor.isEditable ? (
        <input
          ref={inputRef}
          className="tm-inline-math-input"
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value
            setDraft(nextDraft)
            props.updateInlineContent({
              type: 'inlineMath',
              props: {
                latex: nextDraft,
              },
            })
          }}
          onBlur={handleCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleCommit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(latex)
              props.updateInlineContent({
                type: 'inlineMath',
                props: {
                  latex,
                },
              })
              handleCommit()
            }
          }}
          placeholder="输入 LaTeX 公式"
        />
      ) : (
        <span
          className="tm-inline-math-chip"
          onMouseDown={(event) => {
            if (!props.editor.isEditable) return
            event.preventDefault()
            setIsEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </span>
  )
}

function MathBlockRenderer(props: any) {
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
