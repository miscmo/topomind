import { useCallback, useEffect, useMemo, useRef } from 'react'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useThemeStore, isDarkTheme } from '../../../../stores/themeStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from '../smartDocumentTypes'
import { buildPastedImageHtml, getClipboardMarkdownImage, getCodeBlockPlainTextFromHtml, getCodeBlockPlainTextPaste, getSmartDocumentOutlineAndStats, getStandaloneCodeBlockPasteHtml, getUploadedFileUrl, isSameSmartDocumentStats, isSameSmartDocumentToc } from '../smartDocumentUtils'
import { containsMarkdownFence } from '../fenceNormalize'
import { inlineMathInputRuleExtension, mathBlockShortcutExtension, quoteEnterExtension } from '../mathSupport'
import { containsMathDelimiters, containsMarkdownDelimiters, containsStrictMarkdownDelimiters, convertMixedHtmlToHtml, convertMarkdownWithMathToHtml, hasMeaningfulHtmlStructure, stripClipboardHtmlNoise } from '../mathPaste'
import { smartDocumentSchema } from '../smartDocumentSchema'
import { currentBlockHighlightExtension } from '../currentBlockHighlightExtension'
import type { SmartDocumentEditorProps } from '../types'
import type { TocItem } from '../../types/workspaceTypes'
import type { SmartDocumentDerivedBlockCache } from '../smartDocumentUtils'
import { resolveEditorFontFamily } from '../../../../domain/style/styleDefaults'

export function useSmartDocumentEditorModel({
  value,
  onChange,
  onTocChange,
  onWordCountChange,
  onTocItemClickReady,
  uploadFile,
  importRemoteImage,
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
  const editorSessionActiveRef = useRef(true)

  useEffect(() => {
    editorSessionActiveRef.current = true
    return () => {
      editorSessionActiveRef.current = false
    }
  }, [])

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
    // Only compute once on mount; value.blocks is intentionally not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Keep BlockNote's code-block paste invariant when overriding its default
      // handler: code nodes accept literal text only. Sending clipboard HTML
      // through DOM parsing would interpret source such as <Component> or
      // <xxx>...</xxx> as markup and strip it before it reaches the code block.
      // Detect a code-block context with several signals: a whole-block
      // NodeSelection, both selection ends inside a `code` node, or the cursor
      // block being a codeBlock. Relying only on the parent-node spec fails when
      // the block is selected as a node or when the resolved parent is not the
      // code node, which is what let <xxx> slip through to HTML parsing.
      const isSelectionInCodeBlock =
        editor.transact(
          (transaction) => {
            const selection = transaction.selection as unknown as {
              node?: { type: { spec: { code?: boolean } } }
              $from: { parent: { type: { spec: { code?: boolean } } } }
              $to: { parent: { type: { spec: { code?: boolean } } } }
            }
            if (selection.node?.type.spec.code === true) return true
            return (
              selection.$from.parent.type.spec.code === true &&
              selection.$to.parent.type.spec.code === true
            )
          },
        ) ||
        editor.getTextCursorPosition().block.type === 'codeBlock' ||
        (event.target instanceof HTMLElement &&
          !!event.target.closest('[data-content-type="codeBlock"]'))
      const codeBlockPlainText = getCodeBlockPlainTextPaste(isSelectionInCodeBlock, plainText)
      if (codeBlockPlainText !== undefined) {
        editor.pasteText(codeBlockPlainText)
        return true
      }

      // Fall back when the source exposes no text/plain (e.g. code copied
      // from certain web pages / rich-text apps). Prefer the raw text/markdown
      // payload when present: there angle brackets are literal, so <xxx> and
      // 1<<i survive without any HTML interpretation.
      if (isSelectionInCodeBlock && markdown.length > 0) {
        editor.pasteText(markdown)
        return true
      }

      // Last resort: recover literal text from the HTML textContent (entities
      // like &lt;xxx&gt; are decoded by the DOM parser) instead of feeding the
      // raw HTML through pasteHTML where <xxx> would be stripped as markup.
      if (isSelectionInCodeBlock && html.length > 0) {
        const codeBlockHtmlText = getCodeBlockPlainTextFromHtml(html)
        if (codeBlockHtmlText.length > 0) {
          editor.pasteText(codeBlockHtmlText)
          return true
        }
      }

      // text/plain itself contains a code fence (including the 4+ space
      // indentation produced when a fenced block is nested under a list item):
      // parse it as Markdown FIRST. normalizeFenceIndentation() will lift the
      // nested fence to a top-level block before markdown-it runs. Limiting
      // this check to 0-3 spaces bypassed that normalization when both the
      // opening and closing fences were indented.
      if (containsMarkdownFence(plainText)) {
        editor.pasteHTML(convertMarkdownWithMathToHtml(plainText))
        return true
      }

      // A standalone <pre> pasted OUTSIDE a code block should still create a
      // codeBlock with literal angle brackets intact. Do not take over mixed
      // rich text or inline <code>: replacing those payloads with one <pre>
      // would discard headings/paragraphs or promote inline code to a block.
      if (hasHtml) {
        const codeBlockHtml = getStandaloneCodeBlockPasteHtml(html)
        if (codeBlockHtml.length > 0) {
          editor.pasteHTML(codeBlockHtml)
          return true
        }
      }

      // Tencent Docs and similar editors expose the original image URL in
      // text/plain as Markdown, but rendering that remote URL directly is
      // blocked by our CSP and would leave the document dependent on a
      // third-party CDN. Import it through the main process, which validates
      // and downloads the image into this document's _attach/ directory.
      const clipboardImage = getClipboardMarkdownImage(plainText)
      if (clipboardImage && importRemoteImage) {
        void importRemoteImage(clipboardImage.url)
          .then((result) => {
            if (!editorSessionActiveRef.current) return
            const attachmentUrl = getUploadedFileUrl(result)
            if (!attachmentUrl) throw new Error('图片已下载，但未返回附件引用')
            editor.pasteHTML(buildPastedImageHtml(attachmentUrl, clipboardImage.alt))
          })
          .catch((error) => {
            if (!editorSessionActiveRef.current) return
            console.error('Failed to paste remote clipboard image', error)
            // Do not insert the CSP-blocked external URL on failure. Preserve
            // the source as visible text so the user can retry or save it.
            editor.pasteText(plainText)
          })
        return true
      }

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
        // Tencent Docs / WeChat copies wrap inline-only text in a full
        // <html><body> document plus <sc-clipboard> metadata; the real content
        // is duplicated in text/plain. Prefer that clean text whenever the
        // HTML carries no real structure (even without markdown delimiters):
        // convertMixedHtmlToHtml would run inline-markdown replacement on the
        // text and misread lone `*` as italics (e.g. "100W * 50 B"). When
        // text/plain itself carries the wrapper noise, strip it first.
        if (!hasMeaningfulHtmlStructure(html)) {
          const cleanPlain = /<html[\s>]/i.test(plainText) || /<sc-clipboard\b/i.test(plainText)
            ? stripClipboardHtmlNoise(plainText)
            : plainText
          if (cleanPlain.length > 0) {
            editor.pasteHTML(convertMarkdownWithMathToHtml(cleanPlain))
            return true
          }
        }

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
    extensions: [mathBlockShortcutExtension(), currentBlockHighlightExtension(), quoteEnterExtension()],
    _tiptapOptions: {
      extensions: [inlineMathInputRuleExtension],
    },
  })

  const updateStatsAndTocRef = useRef<number | null>(null)
  const idleUpdateStatsAndTocRef = useRef<number | null>(null)
  const lastPublishedTocRef = useRef<TocItem[] | null>(null)
  const lastPublishedStatsRef = useRef<{ characters: number; words: number; blocks: number } | null>(null)
  const derivedBlockCacheRef = useRef<SmartDocumentDerivedBlockCache>(new Map())

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
      const { toc, stats } = getSmartDocumentOutlineAndStats(
        editor,
        derivedBlockCacheRef.current,
      )

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

  const lastDocumentRef = useRef<any>(null)

  const handleChange = useCallback(() => {
    const currentValue = valueRef.current
    const currentDoc = editor.document

    // BlockNote emits change notifications for the same document snapshot in
    // some compound operations. Reference equality is a cheap and sufficient
    // guard here; defer structural comparison to the save/session layer.
    if (currentDoc === lastDocumentRef.current) return
    lastDocumentRef.current = currentDoc

    const nextValue = withSmartDocumentUpdatedAt({
      ...currentValue,
      blocks: currentDoc,
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
