import { BlockNoteSchema, createCodeBlockSpec } from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { MermaidBlock } from 'blocknote-mermaid'
import { InlineMath, MathBlock } from './mathSupport'
import { customCodeBlockOptions } from './components/CustomCodeBlock'

// 用 xl-multi-column 包裹 schema，加入 column / columnList 块，
// 从而支持“同一行多个块 / 拖拽并排”（腾讯文档 / Notion 式分栏）。
// 该包与 BlockNote 0.51.4 精确配对，无需升级 BlockNote。
export const smartDocumentSchema = withMultiColumn(
  BlockNoteSchema.create().extend({
    blockSpecs: {
      codeBlock: createCodeBlockSpec(customCodeBlockOptions),
      mermaid: MermaidBlock(),
      math: MathBlock(),
    },
    inlineContentSpecs: {
      inlineMath: InlineMath,
    },
  }),
)
