import { useEffect, useRef } from 'react'

type SmartDocumentAttachmentEditor = {
  document: any[]
  getSelection: () => { blocks: any[] } | undefined
  getTextCursorPosition: () => { block: any } | undefined
  insertBlocks: (blocks: any[], referenceBlock: any, placement: 'after') => unknown
}

export function useSmartDocumentAttachmentInsert(editor: SmartDocumentAttachmentEditor, attachmentInsertTargetKey?: string) {
  const lastTargetBlockRef = useRef<any>(null)

  // 记录编辑器失去焦点前的最后光标/选中位置
  useEffect(() => {
    if (!editor) return

    const updateLastTarget = () => {
      let foundBlock = undefined
      try {
        const selection = editor.getSelection()
        if (selection && selection.blocks.length > 0) {
          foundBlock = selection.blocks[0]
        }
      } catch (err) {
        // 忽略没有焦点时的报错
      }

      if (!foundBlock) {
        try {
          const cursor = editor.getTextCursorPosition()
          if (cursor && cursor.block) {
            foundBlock = cursor.block
          }
        } catch (err) {
          // 忽略没有焦点时的报错
        }
      }

      if (foundBlock) {
        lastTargetBlockRef.current = foundBlock
      }
    }

    // 监听选区变化、点击、键盘事件，以便在焦点丢失前捕获正确的块
    document.addEventListener('selectionchange', updateLastTarget)
    document.addEventListener('click', updateLastTarget, true)
    document.addEventListener('keyup', updateLastTarget, true)

    return () => {
      document.removeEventListener('selectionchange', updateLastTarget)
      document.removeEventListener('click', updateLastTarget, true)
      document.removeEventListener('keyup', updateLastTarget, true)
    }
  }, [editor])

  useEffect(() => {
    const handleInsertAttachment = (e: CustomEvent) => {
      const { name, url, isImage, targetKey, attachmentRef } = e.detail
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

      // 如果当前没有获取到（因为焦点在侧边栏附件面板），则回退到最后记录的块
      let blockToInsertAfter = targetBlock || lastTargetBlockRef.current

      // 验证待插入的块是否还存在于文档中
      const checkBlockExists = (blocks: any[], blockId: string): boolean => {
        for (const b of blocks) {
          if (b.id === blockId) return true
          if (b.children && checkBlockExists(b.children, blockId)) return true
        }
        return false
      }

      if (blockToInsertAfter && !checkBlockExists(editor.document, blockToInsertAfter.id)) {
        blockToInsertAfter = undefined
      }

      // 最终回退到文档末尾
      if (!blockToInsertAfter) {
        blockToInsertAfter = editor.document[editor.document.length - 1]
      }

      editor.insertBlocks(
        [
          {
            type: isImage ? 'image' : 'file',
            props: {
              url: typeof attachmentRef === 'string' && attachmentRef ? attachmentRef : url,
              name,
              ...(typeof attachmentRef === 'string' && attachmentRef ? { attachmentRef } : {}),
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
