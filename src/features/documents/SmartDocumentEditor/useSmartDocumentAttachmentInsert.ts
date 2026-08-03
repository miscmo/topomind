import { useEffect, useRef } from 'react'

type SmartDocumentAttachmentEditor = {
  document: any[]
  getSelection: () => { blocks: any[] } | undefined
  getTextCursorPosition: () => { block: any } | undefined
  insertBlocks: (blocks: any[], referenceBlock: any, placement: 'after') => unknown
}

export function useSmartDocumentAttachmentInsert(editor: SmartDocumentAttachmentEditor, attachmentInsertTargetKey?: string) {
  const lastTargetBlockRef = useRef<any>(null)
  const updateLastTargetRef = useRef<(() => void) | null>(null)
  const updateFrameRef = useRef<number | null>(null)

  // 记录编辑器失去焦点前的最后光标/选中位置
  useEffect(() => {
    if (!editor) return

    const updateLastTarget = () => {
      // 只在当前编辑器有焦点时更新，避免多实例同时响应全局事件造成污染
      const hasFocus = (editor as any).prosemirrorView?.hasFocus?.() ?? true
      if (!hasFocus) return

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

    const scheduleUpdateLastTarget = () => {
      if (updateFrameRef.current !== null) return
      updateFrameRef.current = window.requestAnimationFrame(() => {
        updateFrameRef.current = null
        updateLastTarget()
      })
    }
    updateLastTargetRef.current = updateLastTarget

    // Coalesce global selection/click/key events into at most one editor query per frame.
    document.addEventListener('selectionchange', scheduleUpdateLastTarget)
    document.addEventListener('click', scheduleUpdateLastTarget, true)
    document.addEventListener('keyup', scheduleUpdateLastTarget, true)

    return () => {
      document.removeEventListener('selectionchange', scheduleUpdateLastTarget)
      document.removeEventListener('click', scheduleUpdateLastTarget, true)
      document.removeEventListener('keyup', scheduleUpdateLastTarget, true)
      if (updateFrameRef.current !== null) {
        window.cancelAnimationFrame(updateFrameRef.current)
        updateFrameRef.current = null
      }
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
