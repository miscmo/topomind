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

const NEWLINE_SPLITTABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
])

function shouldSplitBlockTextByNewlines(block: BlockNoteBlock): boolean {
  return typeof block.type === 'string' && NEWLINE_SPLITTABLE_BLOCK_TYPES.has(block.type)
}

function splitTextByNewlines(blocks: BlockNoteBlock[]): BlockNoteBlock[] {
  const result: BlockNoteBlock[] = []
  
  for (const block of blocks) {
    // 递归处理子块
    let children = block.children
    if (Array.isArray(children)) {
      children = splitTextByNewlines(children as BlockNoteBlock[])
    }

    // 只处理普通文本块，不能作用到 codeBlock 这类本身依赖换行的块
    if (shouldSplitBlockTextByNewlines(block) && Array.isArray(block.content)) {
      let currentContent: any[] = []
      let currentBlock: BlockNoteBlock = { ...block, children, content: currentContent }
      // 为了防止生成的块 id 冲突，如果拆分出新块，后续块不保留原有 id
      let isFirstPart = true
      
      for (const item of block.content) {
        if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') {
          // BlockNote 中如果 text 包含 \n，会导致整个段落变成一个极其巨大的单块
          // 导致无法在段落之间插入图片，且拖拽计算完全失效。
          // 必须按 \n 将其拆分为多个独立的 Block
          const parts = item.text.split('\n')
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
              result.push(currentBlock)
              currentContent = []
              // 后续拆分出的块，去掉 id 让 BlockNote 自动生成，同时子节点只挂在最后一个块上
              currentBlock = { ...block, id: undefined, children: [], content: currentContent }
              isFirstPart = false
            }
            if (parts[i]) {
              currentContent.push({ ...item, text: parts[i] })
            }
          }
        } else {
          currentContent.push(item)
        }
      }
      
      // 如果原来的 children 不为空，并且块被拆分了，
      // 我们需要确保 children 挂在正确的块下（通常是最后一个块）
      if (!isFirstPart && Array.isArray(children) && children.length > 0) {
        currentBlock.children = children
        // 清理掉第一个块上的 children，因为它已经被挂到最后一个块上了
        // 其实在循环里已经设为 [] 了，这里只是挂载到最后
      }

      result.push(currentBlock)
    } else {
      result.push({ ...block, children })
    }
  }
  
  return result
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
  let parsedBlocks = createDefaultBlockNoteBlocks(input.blocks)
  // 核心修复：清理从其他来源（如 Word）粘贴进来的带有 \n 的脏块
  parsedBlocks = splitTextByNewlines(parsedBlocks)
  
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
