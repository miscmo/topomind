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
