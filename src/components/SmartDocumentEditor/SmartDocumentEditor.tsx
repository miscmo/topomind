import { memo, useCallback, useMemo } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore } from '../../stores/themeStore'
import type { SmartDocumentContent } from './smartDocumentTypes'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from './smartDocumentTypes'
import '@blocknote/mantine/style.css'

interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  readOnly?: boolean
}

export const SmartDocumentEditor = memo(function SmartDocumentEditor({ value, onChange, readOnly = false }: SmartDocumentEditorProps) {
  const theme = useThemeStore((state) => state.theme)
  // Only calculate initial content once on mount, since the editor handles its own state afterwards
  const initialContent = useMemo(() => createDefaultBlockNoteBlocks(value.blocks), [])
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
    <div className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
      <div className="max-w-[920px] mx-auto px-5 py-4 pb-10">
        <div className="mb-3 rounded-2xl border border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] shadow-[var(--shadow-sm)] px-4 py-3">
          <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">智能文档 · BlockNote</div>
          <input
            className="w-full border-none outline-none bg-transparent text-[22px] font-bold text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            value={value.title}
            onChange={(event) => onChange(withSmartDocumentUpdatedAt({ ...value, title: event.target.value }))}
            placeholder="未命名智能文档"
            readOnly={readOnly}
          />
        </div>
        <div className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] overflow-hidden">
          <BlockNoteView
            editor={editor}
            editable={!readOnly}
            theme={theme}
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
  )
})
