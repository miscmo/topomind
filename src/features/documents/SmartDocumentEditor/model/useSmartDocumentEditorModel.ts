import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore, isDarkTheme } from '../../../../stores/themeStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from '../smartDocumentTypes'
import { calculateSmartDocumentStats, extractSmartDocumentToc } from '../smartDocumentUtils'
import { inlineMathInputRuleExtension, mathBlockShortcutExtension } from '../mathSupport'
import { containsMathDelimiters, containsMarkdownDelimiters, convertHtmlWithMathToHtml, convertMarkdownWithMathToHtml } from '../mathPaste'
import { smartDocumentSchema } from '../smartDocumentSchema'
import { currentBlockHighlightExtension } from '../currentBlockHighlightExtension'
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

      const hasMath = containsMathDelimiters(plainText) || containsMathDelimiters(markdown)
      const hasMarkdown = containsMarkdownDelimiters(plainText) || containsMarkdownDelimiters(markdown)

      // 1. 如果有显式的 markdown 格式（如从某些专门的编辑器复制）
      if (hasExplicitMarkdown && (hasMath || hasMarkdown)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(markdown))
        return true
      }

      // 2. 如果包含 HTML（富文本），但纯文本中存在 Markdown 或数学公式特征
      // 很多时候从代码编辑器或普通笔记软件复制的内容会带有一层无用的 HTML 外壳，
      // 我们优先将纯文本作为 Markdown 解析，以保证 **粗体** 等标签生效
      if (hasHtml && (hasMath || hasMarkdown)) {
        if (hasMarkdown) {
           // 如果文本中包含 Markdown 标记（例如 **粗体**），通常代表用户复制的是带有 Markdown 语法的文本
           // 此时直接解析纯文本可以确保所有 Markdown 语法生效
           editor.pasteHTML(convertMarkdownWithMathToHtml(plainText))
           return true
        } else if (hasMath) {
           // 对于仅包含数学公式的富文本，为了向后兼容和最大程度保留其他富文本格式，替换 HTML 中的公式节点
           editor.pasteHTML(convertHtmlWithMathToHtml(html))
           return true
        }
      }

      // 3. 纯文本情况
      if (hasMath || hasMarkdown) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(plainText))
        return true
      }

      return defaultPasteHandler()
    },
    extensions: [mathBlockShortcutExtension(), currentBlockHighlightExtension()],
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
    const baseTheme = isDarkTheme(theme) ? darkDefaultTheme : lightDefaultTheme
    
    // 强制使用透明背景，文本颜色交由外部 CSS 变量控制，以确保深色模式下清晰可见
    const backgroundColor = 'transparent'

    return {
      ...baseTheme,
      fontFamily: resolvedFontFamily,
      colors: {
        ...baseTheme.colors,
        editor: {
          ...baseTheme.colors.editor,
          background: backgroundColor,
        }
      }
    }
  }, [theme, resolvedFontFamily])

  return {
    editor,
    handleChange,
    customTheme,
    defaultEditorStyle
  }
}
