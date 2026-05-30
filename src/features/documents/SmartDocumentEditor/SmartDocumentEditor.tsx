import { memo, useMemo, useRef, useEffect, type CSSProperties } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { FormattingToolbarController, SideMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { insertMermaid } from 'blocknote-mermaid'

import type { SmartDocumentEditorProps } from './types'
import { useSmartDocumentEditorModel } from './model/useSmartDocumentEditorModel'
import { useSmartDocumentAttachmentInsert } from './useSmartDocumentAttachmentInsert'
import { SmartDocumentFormattingToolbar } from './components/SmartDocumentFormattingToolbar'
import { SmartDocumentSideMenu } from './components/SmartDocumentSideMenu'

import 'katex/dist/katex.min.css'
import '@blocknote/mantine/style.css'
import './SmartDocumentEditor.css'

export const SmartDocumentEditor = memo(function SmartDocumentEditor(props: SmartDocumentEditorProps) {
  const { readOnly = false, attachmentInsertTargetKey } = props
  const { editor, handleChange, customTheme, defaultEditorStyle } = useSmartDocumentEditorModel(props)

  useSmartDocumentAttachmentInsert(editor as any, attachmentInsertTargetKey)

  const blockNoteViewStyle = useMemo(() => ({
    '--topomind-smart-body-font-size': `${defaultEditorStyle.fontSize}px`,
    '--topomind-smart-font-family': customTheme.fontFamily,
    '--topomind-smart-line-height': String(defaultEditorStyle.lineHeight),
  }) as CSSProperties, [customTheme.fontFamily, defaultEditorStyle.fontSize, defaultEditorStyle.lineHeight])
  const editorRootRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer || !attachmentInsertTargetKey) return

    const savedScroll = localStorage.getItem(`topomind_scroll_${attachmentInsertTargetKey}`)
    if (savedScroll) {
      setTimeout(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = parseFloat(savedScroll)
        }
      }, 50)
    }

    const handleScroll = () => {
      localStorage.setItem(`topomind_scroll_${attachmentInsertTargetKey}`, scrollContainer.scrollTop.toString())
    }
    
    // Use debounced or passive listener
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [attachmentInsertTargetKey])

  useEffect(() => {
    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    const handleContextMenu = (e: MouseEvent) => {
      const editorRoot = editorRootRef.current
      if (!editorRoot || !(e.target instanceof Node) || !editorRoot.contains(e.target)) return

      // 当用户在编辑器内右键时，触发一个鼠标左键点击事件
      // 这可以强制 BlockNote/Prosemirror 将光标移动到鼠标当前悬停的块
      // 从而解决右键粘贴时，内容没有插入到鼠标位置而是插入到旧光标位置的 bug
      if (e.target instanceof Element) {
        const mousedownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: e.clientX,
          clientY: e.clientY,
          button: 0,
        })
        e.target.dispatchEvent(mousedownEvent)
      }
    }
    ownerDocument.addEventListener('contextmenu', handleContextMenu, true)
    return () => ownerDocument.removeEventListener('contextmenu', handleContextMenu, true)
  }, [])

  return (
    <div ref={scrollContainerRef} className="h-full min-h-0 overflow-y-auto" spellCheck={false} style={{ backgroundColor: defaultEditorStyle.backgroundColor || 'var(--color-surface)' }}>
      <div
        ref={editorRootRef}
        className="smart-document-content relative min-h-full [&_.bn-container]:!bg-transparent [&_.bn-container]:!pl-8 [&_.bn-container]:!pr-4 [&_.bn-container]:!py-0 [&_.bn-container]:!max-w-[800px] [&_.bn-container]:!mx-auto [&_.bn-container]:!w-full [&_.bn-editor]:!min-h-0 [&_.bn-editor]:!px-0 [&_.bn-editor]:!py-4 [&_.bn-editor]:!w-full [&_.bn-side-menu]:!gap-0 [&_.bn-editor]:!bg-transparent"
      >
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={customTheme}
          style={blockNoteViewStyle}
          onChange={handleChange}
          formattingToolbar={false}
          sideMenu={false}
          slashMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
                  insertMermaid(),
                  {
                    title: '块级数学公式 (KaTeX)',
                    onItemClick: () => {
                      editor.insertBlocks(
                        [
                          {
                            type: 'math',
                            props: {
                              autoEdit: true,
                            },
                          },
                        ],
                        editor.getTextCursorPosition().block,
                        'after'
                      )
                    },
                    aliases: ['math', 'equation', 'latex', 'katex'],
                    group: 'Media',
                    icon: <span>∑</span>,
                    subtext: '插入块级 LaTeX 数学公式',
                  } as any,
                ],
                query
              )
            }
          />
          <FormattingToolbarController formattingToolbar={SmartDocumentFormattingToolbar} />
          <SideMenuController sideMenu={SmartDocumentSideMenu} />
        </BlockNoteView>
      </div>
    </div>
  )
})
