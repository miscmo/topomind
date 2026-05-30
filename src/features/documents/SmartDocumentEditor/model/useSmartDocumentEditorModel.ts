import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore } from '../../../../stores/themeStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from '../smartDocumentTypes'
import { calculateSmartDocumentStats, extractSmartDocumentToc } from '../smartDocumentUtils'
import { inlineMathInputRuleExtension, mathBlockShortcutExtension } from '../mathSupport'
import { containsMathDelimiters, convertHtmlWithMathToHtml, convertMarkdownWithMathToHtml } from '../mathPaste'
import { smartDocumentSchema } from '../smartDocumentSchema'
import type { SmartDocumentEditorProps } from '../types'
import type { TocItem } from '../../types/workspaceTypes'
import { resolveEditorFontFamily } from '../../../../domain/style/styleDefaults'

export function useSmartDocumentEditorModel({
  value,
  onChange,
  onTocChange,
  onWordCountChange,
  onTocItemClickReady,
  uploadFile,
  resolveFileUrl,
}: SmartDocumentEditorProps) {
  const theme = useThemeStore((state: any) => state.theme)
  const defaultEditorStyle = useGraphUiStore((state: any) => state.defaultEditorStyle)
  const resolvedFontFamily = useMemo(() => resolveEditorFontFamily(defaultEditorStyle.fontFamily), [defaultEditorStyle.fontFamily])

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
    resolveFileUrl,
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const clipboardData = event.clipboardData
      if (!clipboardData) {
        return defaultPasteHandler()
      }

      const hasHtml = clipboardData.types.includes('text/html')
      const hasExplicitMarkdown = clipboardData.types.includes('text/markdown')
      const html = hasHtml ? clipboardData.getData('text/html') : ''
      const markdown = hasExplicitMarkdown ? clipboardData.getData('text/markdown') : ''
      const plainText = clipboardData.getData('text/plain')

      if (hasExplicitMarkdown && containsMathDelimiters(markdown)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(markdown))
        return true
      }

      if (hasHtml && containsMathDelimiters(plainText)) {
        editor.pasteHTML(convertHtmlWithMathToHtml(html))
        return true
      }

      if (containsMathDelimiters(plainText)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(plainText))
        return true
      }

      return defaultPasteHandler()
    },
    extensions: [mathBlockShortcutExtension()],
    _tiptapOptions: {
      extensions: [inlineMathInputRuleExtension],
    },
  })

  const updateStatsAndTocRef = useRef<number | null>(null)

  const updateStatsAndToc = useCallback((isImmediate = false) => {
    if (updateStatsAndTocRef.current !== null) {
      window.clearTimeout(updateStatsAndTocRef.current)
    }

    const execute = () => {
      // Avoid calling this in the render cycle or synchronously during typing if it triggers state updates that cause re-renders
      onTocChange?.(extractSmartDocumentToc(editor))
      onWordCountChange?.(calculateSmartDocumentStats(editor))
    }

    if (isImmediate) {
      // Use setTimeout even for immediate to ensure we don't trigger state updates during render phase
      updateStatsAndTocRef.current = window.setTimeout(execute, 0)
    } else {
      updateStatsAndTocRef.current = window.setTimeout(execute, 500)
    }
  }, [editor, onTocChange, onWordCountChange])

  const handleChange = useCallback(() => {
    // Only update if the document has actually changed to avoid infinite loops
    // The editor.document is a proxy, so we check if it's the same array reference or structurally different
    // Since this is called frequently, we just use a simple check
    if (editor.document === value.blocks) return

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
      onTocItemClickReady?.(null)
    }
  }, [editor, handleTocItemClick, onTocItemClickReady, updateStatsAndToc])

  const customTheme = useMemo(() => {
    const baseTheme = theme === 'dark' ? darkDefaultTheme : lightDefaultTheme
    return {
      ...baseTheme,
      fontFamily: resolvedFontFamily,
      colors: {
        ...baseTheme.colors,
        editor: {
          ...baseTheme.colors.editor,
          text: defaultEditorStyle.textColor,
          background: defaultEditorStyle.backgroundColor || 'transparent',
        }
      }
    }
  }, [theme, defaultEditorStyle, resolvedFontFamily])

  return {
    editor,
    handleChange,
    customTheme,
    defaultEditorStyle
  }
}
