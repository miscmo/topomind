import { memo, useCallback, useMemo } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { AddBlockButton, DragHandleButton, SideMenu, SideMenuController, useBlockNoteEditor, useCreateBlockNote, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { useThemeStore } from '../../stores/themeStore'
import type { SmartDocumentContent } from './smartDocumentTypes'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from './smartDocumentTypes'
import '@blocknote/mantine/style.css'

interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  readOnly?: boolean
}

function SmartDocumentSideMenu() {
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const isEmptyBlock = Array.isArray(block?.content) && block.content.length === 0

  if (!block) {
    return null
  }

  return (
    <SideMenu>
      {isEmptyBlock ? <AddBlockButton /> : <DragHandleButton />}
    </SideMenu>
  )
}

export const SmartDocumentEditor = memo(function SmartDocumentEditor({ value, onChange, readOnly = false }: SmartDocumentEditorProps) {
  const theme = useThemeStore((state) => state.theme)
  const initialContent = useMemo(() => {
    // If the document has no blocks at all (new document), let BlockNote use its default empty paragraph
    // instead of forcing a heading or any other structure.
    const blocks = createDefaultBlockNoteBlocks(value.blocks)
    return blocks.length > 0 ? blocks : undefined
  }, [])
  const editor = useCreateBlockNote({
    initialContent,
  })

  const handleChange = useCallback(() => {
    onChange(withSmartDocumentUpdatedAt({
      ...value,
      blocks: editor.document,
    }))
  }, [editor, onChange, value])

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--color-surface)]" spellCheck={false}>
      <div className="smart-document-content h-full [&_.bn-container]:!bg-transparent [&_.bn-container]:!pl-8 [&_.bn-container]:!pr-2 [&_.bn-container]:!py-0 [&_.bn-editor]:!min-h-0 [&_.bn-editor]:!px-0 [&_.bn-editor]:!py-2 [&_.bn-editor]:!max-w-none [&_.bn-side-menu]:!gap-0">
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={theme}
          onChange={handleChange}
          sideMenu={false}
        >
          <SideMenuController sideMenu={SmartDocumentSideMenu} />
        </BlockNoteView>
      </div>
    </div>
  )
})
