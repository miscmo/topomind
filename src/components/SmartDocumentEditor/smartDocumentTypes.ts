export type BlockNoteBlock = Record<string, unknown>

export interface SmartDocumentContent {
  schema: 'topomind.smart-document'
  version: 1
  title: string
  blocks: BlockNoteBlock[]
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: 'blocknote'
    blocknoteVersion?: string
  }
}

interface LegacySmartDocumentBlock {
  id?: unknown
  type?: unknown
  text?: unknown
  checked?: unknown
  language?: unknown
}

const LEGACY_BLOCK_TYPES = new Set(['heading', 'paragraph', 'bulleted-list', 'numbered-list', 'todo', 'quote', 'code', 'divider'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function createParagraphBlock(content = ''): BlockNoteBlock {
  return {
    type: 'paragraph',
    content,
  }
}

function normalizeBlockNoteBlock(value: unknown): BlockNoteBlock | null {
  if (!isRecord(value)) return null
  if (typeof value.type !== 'string') return null
  if (LEGACY_BLOCK_TYPES.has(value.type) && typeof value.text === 'string') {
    return legacyBlockToBlockNote(value)
  }
  return value
}

function legacyBlockToBlockNote(block: LegacySmartDocumentBlock): BlockNoteBlock {
  const text = typeof block.text === 'string' ? block.text : ''
  if (block.type === 'heading') {
    return {
      type: 'heading',
      props: { level: 2 }, // 改为二级标题，不再使用默认的极大的一级标题
      content: text,
    }
  }
  if (block.type === 'bulleted-list') {
    return {
      type: 'bulletListItem',
      content: text,
    }
  }
  if (block.type === 'numbered-list') {
    return {
      type: 'numberedListItem',
      content: text,
    }
  }
  if (block.type === 'todo') {
    return {
      type: 'checkListItem',
      props: { checked: block.checked === true },
      content: text,
    }
  }
  if (block.type === 'code') {
    return {
      type: 'codeBlock',
      props: typeof block.language === 'string' && block.language ? { language: block.language } : {},
      content: text,
    }
  }
  if (block.type === 'divider') {
    return createParagraphBlock('---')
  }
  return createParagraphBlock(text)
}

export function createDefaultBlockNoteBlocks(blocks: unknown): BlockNoteBlock[] {
  if (!Array.isArray(blocks)) return []
  const normalizedBlocks = blocks
    .map(normalizeBlockNoteBlock)
    .filter((item): item is BlockNoteBlock => Boolean(item))
  return normalizedBlocks.length ? normalizedBlocks : []
}

export function normalizeSmartDocumentContent(value: unknown, fallbackTitle: string): SmartDocumentContent {
  const now = Date.now()
  const input = isRecord(value) ? value : {}
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  
  // 对于新的空文档，我们不传入任何初始的 block，让 BlockNote 自动初始化一个空段落
  // 这样就不会有那个强制转换出来的“Heading 1”默认块了
  const parsedBlocks = createDefaultBlockNoteBlocks(input.blocks)
  
  return {
    schema: 'topomind.smart-document',
    version: 1,
    title: typeof input.title === 'string' ? input.title : fallbackTitle,
    blocks: parsedBlocks.length > 0 ? parsedBlocks : [],
    metadata: {
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      editor: 'blocknote',
      blocknoteVersion: '0.51.2',
    },
  }
}

export function serializeSmartDocumentContent(value: SmartDocumentContent | null): string {
  return value ? JSON.stringify(value) : ''
}

export function withSmartDocumentUpdatedAt(value: SmartDocumentContent): SmartDocumentContent {
  return {
    ...value,
    metadata: {
      ...value.metadata,
      editor: 'blocknote',
      blocknoteVersion: '0.51.2',
      updatedAt: Date.now(),
    },
  }
}
