import { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Store } from '../../core/storage/service'

export function createMentionCompletion(storage: Store, attachmentCardPath?: string | null) {
  return async function mentionCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    const word = context.matchBefore(/@\S*/)
    if (!word) return null
    if (word.from === word.to && !context.explicit) return null

    const searchText = word.text.slice(1).toLowerCase() // Remove the '@'
    
    // We only fetch data if we have an attachmentCardPath
    if (!attachmentCardPath) {
      return null
    }

    try {
      const [documents, attachments] = await Promise.all([
        storage.listDetailDocuments(attachmentCardPath),
        storage.listAttachments(attachmentCardPath)
      ])

      const docOptions = documents.map(doc => ({
        label: doc.name,
        displayLabel: doc.name,
        type: 'text',
        info: '文档',
        apply: `[${doc.name}](${doc.path})`
      }))

      const attachmentOptions = attachments.map(att => {
        const applyText = att.isImage ? `![${att.name}](${att.path})` : `[${att.name}](${att.path})`
        
        return {
          label: att.name,
          displayLabel: att.name,
          type: 'property',
          info: att.isImage ? '图片附件' : '附件',
          apply: applyText
        }
      })

      const allOptions = [...docOptions, ...attachmentOptions].filter(opt => 
        opt.label.toLowerCase().includes(searchText)
      )

      return {
        from: word.from,
        options: allOptions.map(cmd => ({
          label: cmd.label,
          displayLabel: cmd.displayLabel,
          type: cmd.type,
          info: cmd.info,
          apply: (view, completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: cmd.apply },
              selection: { anchor: from + cmd.apply.length }
            })
          }
        })),
        filter: false
      }
    } catch (e) {
      console.error('Failed to fetch mentions data', e)
      return null
    }
  }
}
