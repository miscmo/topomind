import { useEffect } from 'react'

type SmartDocumentAttachmentEditor = {
  document: any[]
  getSelection: () => { blocks: any[] } | undefined
  getTextCursorPosition: () => { block: any } | undefined
  insertBlocks: (blocks: any[], referenceBlock: any, placement: 'after') => unknown
}

export function useSmartDocumentAttachmentInsert(editor: SmartDocumentAttachmentEditor, attachmentInsertTargetKey?: string) {
  useEffect(() => {
    const handleInsertAttachment = (e: CustomEvent) => {
      const { name, url, isImage, targetKey } = e.detail
      if (!editor) return
      if (targetKey && attachmentInsertTargetKey && targetKey !== attachmentInsertTargetKey) return

      let targetBlock = undefined
      try {
        const selection = editor.getSelection()
        if (selection && selection.blocks.length > 0) {
          targetBlock = selection.blocks[0]
        } else {
          targetBlock = editor.getTextCursorPosition()?.block
        }
      } catch (err) {
        // ignore TextSelection endpoint error
      }

      const blockToInsertAfter = targetBlock || editor.document[editor.document.length - 1]

      editor.insertBlocks(
        [
          {
            type: isImage ? 'image' : 'file',
            props: {
              url,
              name,
            },
          },
        ],
        blockToInsertAfter,
        'after'
      )
    }

    window.addEventListener('insert-attachment', handleInsertAttachment as EventListener)
    return () => {
      window.removeEventListener('insert-attachment', handleInsertAttachment as EventListener)
    }
  }, [attachmentInsertTargetKey, editor])
}
