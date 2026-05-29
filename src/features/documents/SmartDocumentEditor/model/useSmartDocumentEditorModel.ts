import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore } from '../../../../stores/themeStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from '../smartDocumentTypes'
import { calculateSmartDocumentStats, extractSmartDocumentToc } from '../smartDocumentUtils'
import { smartDocumentSchema } from '../smartDocumentSchema'
import type { SmartDocumentEditorProps } from '../types'
import type { TocItem } from '../../types/workspaceTypes'

export function useSmartDocumentEditorModel({
  value,
  onChange,
  onTocChange,
  onWordCountChange,
  onTocItemClickReady,
  uploadFile
}: SmartDocumentEditorProps) {
  const theme = useThemeStore((state: any) => state.theme)
  const defaultEditorStyle = useGraphUiStore((state: any) => state.defaultEditorStyle)

  const initialContent = useMemo(() => {
    // If the document has no blocks at all (new document), let BlockNote use its default empty paragraph
    // instead of forcing a heading or any other structure.
    const blocks = createDefaultBlockNoteBlocks(value.blocks)
    return blocks.length > 0 ? blocks : undefined
  }, [])

  const editor = useCreateBlockNote({
    schema: smartDocumentSchema,
    initialContent,
    uploadFile,
  })

  const updateStatsAndTocRef = useRef<number | null>(null)

  const updateStatsAndToc = useCallback((isImmediate = false) => {
    if (updateStatsAndTocRef.current !== null) {
      window.clearTimeout(updateStatsAndTocRef.current)
    }

    const execute = () => {
      onTocChange?.(extractSmartDocumentToc(editor))
      onWordCountChange?.(calculateSmartDocumentStats(editor))
    }

    if (isImmediate) {
      execute()
    } else {
      updateStatsAndTocRef.current = window.setTimeout(execute, 500)
    }
  }, [editor, onTocChange, onWordCountChange])

  const handleChange = useCallback(() => {
    const nextValue = withSmartDocumentUpdatedAt({
      ...value,
      blocks: editor.document,
    })
    onChange(nextValue)
    updateStatsAndToc(false)
  }, [editor, onChange, value, updateStatsAndToc])

  const handleTocItemClick = useCallback((item: TocItem) => {
    try {
      editor.setTextCursorPosition(item.id, 'start')
      editor.prosemirrorView.dispatch(editor.prosemirrorView.state.tr.scrollIntoView())
      editor.focus()
    } catch {
      updateStatsAndToc(true)
    }
  }, [editor, updateStatsAndToc])

  useEffect(() => {
    updateStatsAndToc(true)
    onTocItemClickReady?.(handleTocItemClick)
    return () => {
      if (updateStatsAndTocRef.current !== null) {
        window.clearTimeout(updateStatsAndTocRef.current)
      }
      onTocChange?.([])
      onWordCountChange?.({ characters: 0, words: 0, blocks: 0 })
      onTocItemClickReady?.(null)
    }
  }, [editor, handleTocItemClick, onTocChange, onWordCountChange, onTocItemClickReady, updateStatsAndToc])

  const customTheme = useMemo(() => {
    const baseTheme = theme === 'dark' ? darkDefaultTheme : lightDefaultTheme
    return {
      ...baseTheme,
      fontFamily: defaultEditorStyle.fontFamily === 'inherit' ? baseTheme.fontFamily : defaultEditorStyle.fontFamily,
      colors: {
        ...baseTheme.colors,
        editor: {
          ...baseTheme.colors.editor,
          text: defaultEditorStyle.textColor,
          background: defaultEditorStyle.backgroundColor || 'transparent',
        }
      }
    }
  }, [theme, defaultEditorStyle])

  return {
    editor,
    handleChange,
    customTheme,
    defaultEditorStyle
  }
}
