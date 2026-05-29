import { BlockNoteSchema, createCodeBlockSpec } from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { createReactBlockSpec } from '@blocknote/react'
import { MermaidBlock } from 'blocknote-mermaid'
import katex from 'katex'

const MathBlock = createReactBlockSpec(
  {
    type: 'math',
    propSchema: {
      expression: {
        default: 'E=mc^2',
      },
    },
    content: 'none',
  },
  {
    render: (props) => {
      return (
        <div
          className="tm-math-block"
          style={{
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backgroundColor: 'var(--color-bg-muted)',
            borderRadius: '6px',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div
            className="tm-math-block-preview"
            style={{
              padding: '8px',
              overflowX: 'auto',
              display: 'flex',
              justifyContent: 'center',
            }}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(props.block.props.expression || ' ', {
                displayMode: true,
                throwOnError: false,
              }),
            }}
          />
          <textarea
            className="tm-math-block-input bn-editor-input"
            rows={3}
            value={props.block.props.expression}
            onChange={(e) =>
              props.editor.updateBlock(props.block, {
                type: 'math',
                props: { expression: e.target.value },
              })
            }
            placeholder="输入 LaTeX 公式..."
            style={{
              width: '100%',
              fontFamily: 'monospace',
              padding: '6px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              fontSize: '13px',
              outline: 'none',
              resize: 'vertical',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--color-primary)'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--color-border)'
            }}
          />
        </div>
      )
    },
  }
)

export const smartDocumentSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    mermaid: MermaidBlock(),
    math: MathBlock(),
  },
})
