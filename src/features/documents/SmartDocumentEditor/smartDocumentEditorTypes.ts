import { useBlockNoteEditor } from '@blocknote/react'
import type { smartDocumentSchema } from './smartDocumentSchema'

type SmartBlockSchema = typeof smartDocumentSchema.blockSchema
type SmartInlineSchema = typeof smartDocumentSchema.inlineContentSchema
type SmartStyleSchema = typeof smartDocumentSchema.styleSchema

/** 项目实际使用的 BlockNote 编辑器 / 块类型，供各组件替代 any 泛型参数。 */
export type SmartDocumentEditor = typeof smartDocumentSchema.BlockNoteEditor
export type SmartDocumentBlock = SmartDocumentEditor['document'][number]
export type SmartDocumentPartialBlock = Parameters<SmartDocumentEditor['updateBlock']>[1]

/** 统一拿到带项目 schema 的编辑器，避免每个组件重复写 <any, any, any>。 */
export function useSmartBlockNoteEditor(): SmartDocumentEditor {
  return useBlockNoteEditor<SmartBlockSchema, SmartInlineSchema, SmartStyleSchema>()
}
