import { BlockNoteSchema, createCodeBlockSpec } from '@blocknote/core'
import { MermaidBlock } from 'blocknote-mermaid'
import { InlineMath, MathBlock } from './mathSupport'
import { customCodeBlockOptions } from './components/CustomCodeBlock'

export const smartDocumentSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    codeBlock: createCodeBlockSpec(customCodeBlockOptions),
    mermaid: MermaidBlock(),
    math: MathBlock(),
  },
  inlineContentSpecs: {
    inlineMath: InlineMath,
  },
})
