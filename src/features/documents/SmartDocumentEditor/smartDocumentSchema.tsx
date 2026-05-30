import { BlockNoteSchema, createCodeBlockSpec } from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { MermaidBlock } from 'blocknote-mermaid'
import { InlineMath, MathBlock } from './mathSupport'

export const smartDocumentSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    mermaid: MermaidBlock(),
    math: MathBlock(),
  },
  inlineContentSpecs: {
    inlineMath: InlineMath,
  },
})
