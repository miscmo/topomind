import { normalizeHeadingNumbering, type HeadingNumberingConfig } from './headingNumbering.ts'

/**
 * 运行时契约：每个块都带稳定 id（BlockNote UUID 或下方补齐的 id）。
 * TS 侧保留可选，是因为构造期允许先不给 id；落盘前一定会被补齐。
 * AI 定位块只认这个 id，绝不用标题、数组下标或路径文本。
 */
export type BlockNoteBlock = Record<string, unknown> & { id?: string }

export interface SmartDocumentContent {
  schema: 'topomind.smart-document'
  version: 1
  title: string
  blocks: BlockNoteBlock[]
  /** 标题自动编号设置（文档级）。缺省＝关闭，旧文档不写该字段即可零影响。 */
  numbering?: HeadingNumberingConfig
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: 'blocknote'
    blocknoteVersion?: string
    /** AI 文档工具写入的摘要 / 标签 / 来源；必须显式透传，否则下一次 autosave 会静默丢掉。 */
    summary?: string
    tags?: string[]
    generatedBy?: 'ai' | 'user'
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

/** 新块用真 UUID；只有「读旧档时补 id」才用下面的确定性兜底。 */
export function newSmartDocumentBlockId(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return `blk-${cryptoRef.randomUUID()}`
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hashBlockSeed(seed: string): string {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function readBlockText(block: BlockNoteBlock): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as Record<string, unknown>).text
      return typeof text === 'string' ? text : ''
    }).join('')
  }
  return typeof block.text === 'string' ? block.text : ''
}

/**
 * 给缺 id 的历史块补一个**确定性** id（内容 + 树路径哈希）。
 *
 * 为什么不能随机：normalize 每次 value 变化都会重跑，随机 id 会让同一块
 * 在「编辑器内存」「document.read 摘要」「AI 写入时的 base.blocks」三处各不
 * 相同，AI 拿着 id 反而定位不到。确定性兜底保证三处一致；已经有 id 的块
 * 一律原样保留，用户编辑 / 保存都不会改变它的身份。
 */
export function ensureStableBlockIds(blocks: BlockNoteBlock[], parentPath = ''): BlockNoteBlock[] {
  let changed = false
  const next = blocks.map((block, index) => {
    if (!isRecord(block)) return block
    const path = parentPath ? `${parentPath}.${index}` : String(index)
    const patched: BlockNoteBlock = { ...block }
    if (typeof patched.id !== 'string' || !patched.id) {
      const seed = `${path}|${String(patched.type ?? '')}|${readBlockText(patched)}`
      patched.id = `blk-${hashBlockSeed(seed)}-${path.replace(/\./g, '-')}`
      changed = true
    }
    if (Array.isArray(patched.children)) {
      const children = ensureStableBlockIds(patched.children as BlockNoteBlock[], path)
      if (children !== patched.children) {
        patched.children = children
        changed = true
      }
    }
    return patched
  })
  return changed ? next : blocks
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
  // 注意：quote 不在其中。BlockNote 的多行引用就是一个 quote 块内文本含 \n
  // （pre-wrap 渲染换行）。若按 \n 拆分，每次打开文档都会被拆成多个引用块。
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
      let currentContent: unknown[] = []
      let currentBlock: BlockNoteBlock = { ...block, children, content: currentContent }
      // 拆分出的后续块必须给一个全新的稳定 id，不能复用原块 id（会冲突），
      // 也不能留空让 BlockNote 在 mount 时才补（那样落盘瞬间该块没有可寻址身份）。
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
              // 后续拆分出的块给全新 UUID，子节点只挂在最后一个块上
              currentBlock = { ...block, id: newSmartDocumentBlockId(), children: [], content: currentContent }
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
  // 读入即保证每个块都有可寻址身份：编辑器内存、document.read 摘要、
  // AI 写入的 base.blocks 三处共用同一套确定性补齐，blockId 才能对得上。
  parsedBlocks = ensureStableBlockIds(parsedBlocks)

  return {
    schema: 'topomind.smart-document',
    version: 1,
    title: typeof input.title === 'string' ? input.title : fallbackTitle,
    blocks: parsedBlocks.length > 0 ? parsedBlocks : [],
    // 必须显式透传：documentEditorRegistry 在每次 value 变化时都会跑本函数重建对象，
    // 漏写就等于「工具栏开关点了不生效 / 重开文档设置丢失」（与连线曲线字段同型）。
    ...(input.numbering !== undefined
      ? { numbering: normalizeHeadingNumbering(input.numbering) }
      : {}),
    metadata: {
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      editor: 'blocknote',
      blocknoteVersion: '0.51.2',
      // AI 写入的摘要 / 标签是业务数据，normalize 每次 value 变化都会重建对象，
      // 漏透传就等于「AI 写完、用户下一次敲键后字段消失」。
      ...(typeof metadata.summary === 'string'
        ? { summary: metadata.summary.slice(0, 2000) }
        : {}),
      ...(Array.isArray(metadata.tags)
        ? { tags: metadata.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) }
        : {}),
      ...(metadata.generatedBy === 'ai' || metadata.generatedBy === 'user'
        ? { generatedBy: metadata.generatedBy }
        : {}),
    },
  }
}

export function serializeSmartDocumentContent(value: SmartDocumentContent | null): string {
  return value ? JSON.stringify(value) : ''
}

export function withSmartDocumentUpdatedAt(value: SmartDocumentContent): SmartDocumentContent {
  return {
    ...value,
    // 落盘前最后一道闸：已有 id 一律保留，缺 id 的历史块补确定性 id。
    blocks: ensureStableBlockIds(value.blocks),
    metadata: {
      ...value.metadata,
      editor: 'blocknote',
      blocknoteVersion: '0.51.2',
      updatedAt: Date.now(),
    },
  }
}
