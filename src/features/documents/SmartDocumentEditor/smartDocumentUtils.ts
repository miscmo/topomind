import type { TocItem } from '../types/workspaceTypes'

export function inlineContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
    return ''
  }).join('').trim()
}

export function extractSmartDocumentToc(editor: { forEachBlock: (visitor: (block: any) => boolean) => void }): TocItem[] {
  const items: TocItem[] = []
  editor.forEachBlock((block: any) => {
    if (block?.type !== 'heading') return true
    const text = inlineContentToText(block.content)
    if (!text) return true
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
    return true
  })
  return items
}

export function calculateSmartDocumentStats(editor: { forEachBlock: (visitor: (block: any) => boolean) => void }) {
  let characters = 0
  let words = 0
  let blocks = 0

  editor.forEachBlock((block: any) => {
    blocks++
    if (block.content) {
      const text = inlineContentToText(block.content)
      if (text) {
        const trimmed = text.trim()
        characters += trimmed.replace(/\s/g, '').length
        const tokens = trimmed.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]|\S/g)
        if (tokens) {
          words += tokens.length
        }
      }
    }
    return true
  })

  return { characters, words, blocks }
}
