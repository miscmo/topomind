import type { TocItem } from '../types/workspaceTypes'

type SmartDocumentStats = { characters: number; words: number; blocks: number }

type BlockWalkerEditor = {
  forEachBlock: (visitor: (block: any) => boolean) => void
}

export function inlineContentToPlainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'inlineMath' &&
      'props' in item &&
      item.props &&
      typeof item.props === 'object' &&
      'latex' in item.props &&
      typeof item.props.latex === 'string'
    ) {
      return item.props.latex
    }
    return ''
  }).join('')
}

export function inlineContentToText(content: unknown): string {
  return inlineContentToPlainText(content).trim()
}

type SmartDocumentBlockLike = {
  id?: string
  type?: string
  content?: unknown
  children?: SmartDocumentBlockLike[]
}

export type SmartDocumentSelectedTextState = {
  rawText: string
  latex: string
  canConvertInlineMath: boolean
  canConvertBlockMath: boolean
}

export function cloneSmartDocumentBlockWithoutIds<T extends SmartDocumentBlockLike>(block: T): Omit<T, 'id'> {
  const clone = JSON.parse(JSON.stringify(block)) as T
  delete clone.id
  if (Array.isArray(clone.children)) {
    clone.children = clone.children.map(cloneSmartDocumentBlockWithoutIds)
  }
  return clone
}

export function getSmartDocumentBlockPlainText(block: SmartDocumentBlockLike): string {
  const ownText = inlineContentToPlainText(block.content)
  const childText = Array.isArray(block.children)
    ? block.children.map(getSmartDocumentBlockPlainText).filter(Boolean).join('\n')
    : ''
  return [ownText, childText].filter(Boolean).join('\n')
}

export function getSmartDocumentMenuTargetBlockIds(
  menuBlockId: string,
  selectedBlocks?: SmartDocumentBlockLike[],
): string[] {
  if (selectedBlocks?.some((item) => item.id === menuBlockId)) {
    return selectedBlocks
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }
  return [menuBlockId]
}

export function getSmartDocumentBlocksClipboardText(
  blocks: SmartDocumentBlockLike[],
  fallbackText = '',
): string {
  return blocks.map(getSmartDocumentBlockPlainText).filter(Boolean).join('\n') || fallbackText
}

export async function writeClipboardBeforeMutation(
  text: string,
  writeText: (value: string) => Promise<void>,
  mutation: () => void,
): Promise<boolean> {
  try {
    await writeText(text)
    mutation()
    return true
  } catch {
    return false
  }
}

export function getCodeBlockPlainTextPaste(
  isSelectionInCodeBlock: boolean,
  plainText: string,
): string | undefined {
  return isSelectionInCodeBlock && plainText.length > 0 ? plainText : undefined
}

/**
 * Recovers literal code text from a clipboard `text/html` payload. Some
 * clipboard sources (web code blocks, rich-text apps, PDFs) expose only HTML,
 * and the angle brackets in it are often MIXED: `i < n` may arrive as
 * `i &lt; n` while `#include<iostream>` and `1<<i` stay raw. Any DOM parse of
 * that payload treats the raw `<i` as an `<i>` tag and swallows the rest.
 *
 * So we never use a DOM parser here: we only remove KNOWN wrapper tags
 * (pre/code/span/div...) and decode entities. Unescaped `<xxx>`/`<iostream>`
 * survive because they are not in the wrapper whitelist, while `&lt;`/`&amp;`
 * decode correctly. This is uniformly correct for raw, partially escaped, and
 * fully escaped HTML alike. DOM-free, so it also runs in Node for unit tests.
 */

// Deliberately excludes single-letter tags (i/b/u/s/em/strong/a...) that
// commonly appear inside code (`1<<i` would match `<i`); only strips wrapper
// tags that a clipboard HTML serialization would legitimately produce.
const HTML_WRAPPER_TAGS = [
  'pre', 'code', 'span', 'div', 'p', 'font',
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'section', 'article', 'header', 'footer',
  'nav', 'main', 'figure', 'figcaption', 'aside',
  'meta', 'style', 'script', 'title',
].join('|')

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function stripHtmlWrapperTags(value: string): string {
  let output = value
    .replace(new RegExp(`</(?:${HTML_WRAPPER_TAGS})>`, 'gi'), '\n')
    .replace(new RegExp(`<(?:${HTML_WRAPPER_TAGS})(?:\\s[^>]*)?>`, 'gi'), '')
    .replace(/<br\s*\/?>/gi, '\n')
  output = output.replace(/\n{3,}/g, '\n\n')
  return output.trim()
}

/**
 * Recovers literal code text from a clipboard `text/html` payload. Some
 * clipboard sources (web code blocks, rich-text apps, PDFs) expose only HTML,
 * and the angle brackets in it are often MIXED: `i < n` may arrive as
 * `i &lt; n` while `#include<iostream>` and `1<<i` stay raw. Any DOM parse of
 * that payload treats the raw `<i` as an `<i>` tag and swallows the rest.
 *
 * So we never use a DOM parser here: we only remove KNOWN wrapper tags
 * (pre/code/span/div...) and decode entities. Unescaped `<xxx>`/`<iostream>`
 * survive because they are not in the wrapper whitelist, while `&lt;`/`&amp;`
 * decode correctly. This is uniformly correct for raw, partially escaped, and
 * fully escaped HTML alike. DOM-free, so it also runs in Node for unit tests.
 */
export function getCodeBlockPlainTextFromHtml(
  html: string,
  extractText?: (html: string) => string,
): string {
  if (!html || html.length === 0) return ''
  const extract = extractText ?? ((value: string) => stripHtmlWrapperTags(decodeHtmlEntities(value)))
  return extract(html)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function extractCodeLanguage(html: string): string {
  // Only trust an explicit data-language or class="language-xxx" marker on a
  // <pre>/<code> tag — never treat an arbitrary class (e.g. a random
  // syntax-highlighting span class like `e6vjtes0`) as a language.
  const dataLang = html.match(/<(?:pre|code)[^>]*\bdata-language="([^"]+)"/i)
  if (dataLang) return dataLang[1]
  const classLang = html.match(/<(?:pre|code)[^>]*\bclass="[^"]*\blanguage-([\w+-]+)/i)
  if (classLang) return classLang[1]
  return ''
}

/**
 * Builds a clean, escaped `<pre><code>` HTML payload from a clipboard
 * `text/html` that is structured as a code block. BlockNote auto-creates a
 * codeBlock from `<pre>/<code>` markup; if we handed the raw HTML through,
 * any DOM parse would interpret `<xxx>`/`1<<i` as markup and strip it. By
 * recovering the literal text and re-escaping it, the code block is created
 * with angle brackets intact — regardless of where the cursor was.
 *
 * Returns `''` when the payload has no recoverable text.
 */
export function getCodeBlockPasteHtml(
  html: string,
  extractText?: (html: string) => string,
): string {
  if (!html || html.length === 0) return ''
  // Prefer the first <pre>...</pre> block so surrounding content (headings,
  // paragraphs) is NOT swallowed into the code block.
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  const codeSource = preMatch ? preMatch[1] : html
  const codeText = getCodeBlockPlainTextFromHtml(codeSource, extractText)
  if (codeText.length === 0) return ''
  const language = extractCodeLanguage(html)
  const codeOpen = language
    ? `<code data-language="${escapeHtml(language)}">`
    : '<code>'
  return `<pre>${codeOpen}${escapeHtml(codeText)}</code></pre>`
}

export function getSmartDocumentSelectedTextState(
  rawText: string,
  selectedBlocks: SmartDocumentBlockLike[],
): SmartDocumentSelectedTextState | undefined {
  const latex = rawText.trim()
  if (!latex) return undefined

  const allBlocksSupportInlineContent = selectedBlocks.length > 0
    && selectedBlocks.every((block) => Array.isArray(block.content))

  return {
    rawText,
    latex,
    canConvertInlineMath: allBlocksSupportInlineContent
      && selectedBlocks.length === 1
      && !latex.includes('\n'),
    canConvertBlockMath: allBlocksSupportInlineContent,
  }
}

export function getSmartDocumentOutlineAndStats(editor: BlockWalkerEditor): {
  toc: TocItem[]
  stats: SmartDocumentStats
} {
  const items: TocItem[] = []
  let characters = 0
  let words = 0
  let blocks = 0

  editor.forEachBlock((block: any) => {
    blocks++

    const text = block.content ? inlineContentToText(block.content) : ''
    if (text) {
      const trimmed = text.trim()
      characters += trimmed.replace(/\s/g, '').length
      const tokens = trimmed.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]|\S/g)
      if (tokens) {
        words += tokens.length
      }
    }

    if (block?.type === 'heading' && text) {
      const rawLevel = block.props?.level
      const level = typeof rawLevel === 'number' && Number.isFinite(rawLevel)
        ? Math.min(Math.max(rawLevel, 1), 6)
        : 1
      items.push({
        id: block.id,
        level,
        text,
        line: items.length + 1,
      })
    }

    return true
  })

  return {
    toc: items,
    stats: { characters, words, blocks },
  }
}

export function extractSmartDocumentToc(editor: BlockWalkerEditor): TocItem[] {
  return getSmartDocumentOutlineAndStats(editor).toc
}

export function calculateSmartDocumentStats(editor: BlockWalkerEditor): SmartDocumentStats {
  return getSmartDocumentOutlineAndStats(editor).stats
}

export function isSameSmartDocumentToc(previous: TocItem[] | null, next: TocItem[]) {
  if (!previous) return false
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    const previousItem = previous[index]
    const nextItem = next[index]
    if (
      previousItem.id !== nextItem.id ||
      previousItem.level !== nextItem.level ||
      previousItem.text !== nextItem.text ||
      previousItem.line !== nextItem.line
    ) {
      return false
    }
  }
  return true
}

export function isSameSmartDocumentStats(previous: SmartDocumentStats | null, next: SmartDocumentStats) {
  if (!previous) return false
  return (
    previous.characters === next.characters &&
    previous.words === next.words &&
    previous.blocks === next.blocks
  )
}
