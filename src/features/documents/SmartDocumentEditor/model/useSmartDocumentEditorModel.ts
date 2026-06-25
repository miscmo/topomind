import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore, isDarkTheme } from '../../../../stores/themeStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from '../smartDocumentTypes'
import { getSmartDocumentOutlineAndStats, isSameSmartDocumentStats, isSameSmartDocumentToc } from '../smartDocumentUtils'
import { inlineMathInputRuleExtension, mathBlockShortcutExtension } from '../mathSupport'
import { containsMathDelimiters, containsMarkdownDelimiters, containsStrictMarkdownDelimiters, convertMixedHtmlToHtml, convertMarkdownWithMathToHtml } from '../mathPaste'
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
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onTocChangeRef = useRef(onTocChange)
  const onWordCountChangeRef = useRef(onWordCountChange)
  const onTocItemClickReadyRef = useRef(onTocItemClickReady)

  valueRef.current = value
  onChangeRef.current = onChange
  onTocChangeRef.current = onTocChange
  onWordCountChangeRef.current = onWordCountChange
  onTocItemClickReadyRef.current = onTocItemClickReady

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
      const isVsCode = clipboardData.types.includes('vscode-editor-data')
      
      const html = hasHtml ? clipboardData.getData('text/html') : ''
      const markdown = hasExplicitMarkdown ? clipboardData.getData('text/markdown') : ''
      const plainText = clipboardData.getData('text/plain')

      const hasMath = containsMathDelimiters(plainText) || containsMathDelimiters(markdown)
      const hasMarkdown = containsMarkdownDelimiters(plainText) || containsMarkdownDelimiters(markdown)
      const hasStrictMarkdown = containsStrictMarkdownDelimiters(plainText)

      // 1. 显式 Markdown 格式 (如从 Typora、Obsidian 等专门 MD 编辑器复制)
      if (hasExplicitMarkdown && (hasMath || hasMarkdown)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(markdown))
        return true
      }

      // 2. 从代码编辑器 (如 VSCode) 复制，带有一层无用的代码高亮 HTML 外壳
      // 此时我们剥离 HTML，直接将纯文本作为 Markdown 解析
      if (isVsCode && (hasMath || hasMarkdown)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(plainText))
        return true
      }

      // 3. 常规富文本 (如网页、Word、Excel 等)
      // 优先信任并保留 HTML 格式，防止丢失图片、表格和排版。同时扫描并转换其中的数学公式和夹杂的 Markdown 语法。
      if (hasHtml) {
        // 使用混合模式解析，处理 HTML 内部的 Markdown 和公式，修复残缺的代码块等
        editor.pasteHTML(convertMixedHtmlToHtml(html))
        return true
      }

      // 4. 纯文本情况 (如记事本、Ctrl+Shift+V 无格式粘贴)
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
  const idleUpdateStatsAndTocRef = useRef<number | null>(null)
  const lastPublishedTocRef = useRef<TocItem[] | null>(null)
  const lastPublishedStatsRef = useRef<{ characters: number; words: number; blocks: number } | null>(null)

  const clearScheduledStatsAndToc = useCallback(() => {
    if (updateStatsAndTocRef.current !== null) {
      window.clearTimeout(updateStatsAndTocRef.current)
      updateStatsAndTocRef.current = null
    }

    if (idleUpdateStatsAndTocRef.current !== null) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void
      }
      if (typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleUpdateStatsAndTocRef.current)
      } else {
        window.clearTimeout(idleUpdateStatsAndTocRef.current)
      }
      idleUpdateStatsAndTocRef.current = null
    }
  }, [])

  const updateStatsAndToc = useCallback((isImmediate = false) => {
    clearScheduledStatsAndToc()

    const runDerivedCalculation = () => {
      const { toc, stats } = getSmartDocumentOutlineAndStats(editor)

      if (!isSameSmartDocumentToc(lastPublishedTocRef.current, toc)) {
        lastPublishedTocRef.current = toc
        onTocChangeRef.current?.(toc)
      }

      if (!isSameSmartDocumentStats(lastPublishedStatsRef.current, stats)) {
        lastPublishedStatsRef.current = stats
        onWordCountChangeRef.current?.(stats)
      }
    }

    const scheduleDerivedCalculation = () => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number }
        ) => number
      }

      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleUpdateStatsAndTocRef.current = idleWindow.requestIdleCallback(() => {
          idleUpdateStatsAndTocRef.current = null
          runDerivedCalculation()
        }, { timeout: 300 })
        return
      }

      idleUpdateStatsAndTocRef.current = window.setTimeout(() => {
        idleUpdateStatsAndTocRef.current = null
        runDerivedCalculation()
      }, 0)
    }

    updateStatsAndTocRef.current = window.setTimeout(
      scheduleDerivedCalculation,
      isImmediate ? 0 : 700
    )
  }, [clearScheduledStatsAndToc, editor])

  const handleChange = useCallback(() => {
    const currentValue = valueRef.current
    // Only update if the document has actually changed to avoid infinite loops
    // The editor.document is a proxy, so we check if it's the same array reference or structurally different
    // Since this is called frequently, we just use a simple check
    if (editor.document === currentValue.blocks) return

    const nextValue = withSmartDocumentUpdatedAt({
      ...currentValue,
      blocks: editor.document,
    })
    onChangeRef.current(nextValue)
    updateStatsAndToc(false)
  }, [editor, updateStatsAndToc])

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
    onTocItemClickReadyRef.current?.(handleTocItemClick)
    return () => {
      clearScheduledStatsAndToc()
      onTocItemClickReadyRef.current?.(null)
    }
  }, [clearScheduledStatsAndToc, editor, handleTocItemClick, updateStatsAndToc])

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
