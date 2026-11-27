/**
 * 发问瞬间把「选中目标的当前内容」随本轮 user message 一起外发。
 *
 * 为什么必须有这一层：只给 id 不给内容时，模型要回答「给修改建议 / 分析格式」
 * 就必然先调 document.read；一旦模型或网关没有返回 tool_calls，编排器按
 * 「无工具调用 = 本轮结束」收尾，用户只看到一句「我先读取这篇文档…：」再无下文。
 * 内容随轮附带后，纯文本模型也能直接作答，工具链路只用于生成可勾选的修改预览。
 *
 * 边界：只走 runtime.read.readDocument（与 document.read 工具同源、同一批 blockId），
 * 不新开 IPC、不直接读盘、不写会话正文；白名单摘要 + 限长；读失败静默降级为空串。
 */
import type { SelectionContextSnapshot } from '../tools/toolTypes'

const MAX_DOCS = 2
const MAX_BLOCKS_PER_DOC = 160
const MAX_BLOCK_TEXT = 1200
const MAX_TOTAL_CHARS = 8000

type ReadDocument = (docId: string) => Promise<Record<string, unknown>>

interface BlockLine {
  id: string
  type: string
  text: string
}

export interface SelectionContentInput {
  selection: SelectionContextSnapshot
  readDocument: ReadDocument
}

function readText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function parseBlocks(raw: unknown): BlockLine[] {
  if (!Array.isArray(raw)) return []
  const out: BlockLine[] = []
  for (const item of raw.slice(0, MAX_BLOCKS_PER_DOC)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const block = item as Record<string, unknown>
    out.push({
      id: readText(block, 'id'),
      type: readText(block, 'type') || 'block',
      text: readText(block, 'text'),
    })
  }
  return out
}

/** 需要优先完整呈现的块：当前选区块 + 引用 chip 里带的块。 */
function focusBlockIds(selection: SelectionContextSnapshot): Set<string> {
  const ids = [...selection.blockIds]
  for (const target of selection.pinned) {
    if (Array.isArray(target.blockIds)) ids.push(...target.blockIds)
  }
  return new Set(ids.filter((id) => typeof id === 'string' && id.trim()))
}

function collectDocIds(selection: SelectionContextSnapshot): string[] {
  const ids: string[] = []
  const push = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return
    const id = raw.trim()
    if (!id || ids.includes(id) || ids.length >= MAX_DOCS) return
    ids.push(id)
  }
  push(selection.documentId)
  for (const target of selection.pinned) push(target.docId)
  return ids
}

export async function buildSelectionContentEnvelope(input: SelectionContentInput): Promise<string> {
  const { selection, readDocument } = input
  const docIds = collectDocIds(selection)
  if (docIds.length === 0) return ''
  const focus = focusBlockIds(selection)
  const sections: string[] = []
  let used = 0

  for (const docId of docIds) {
    let doc: Record<string, unknown>
    try {
      doc = await readDocument(docId)
    } catch {
      continue
    }
    if (!doc || typeof doc !== 'object' || doc.empty === true) continue
    const blocks = parseBlocks(doc.blocks)
    if (blocks.length === 0) continue
    const title = readText(doc, 'title') || (docId === selection.documentId ? selection.documentTitle : '')
    // 选中块排在最前，保证限长截断时优先保住用户真正关心的那几块。
    const ordered = [
      ...blocks.filter((block) => focus.has(block.id)),
      ...blocks.filter((block) => !focus.has(block.id)),
    ]
    const lines: string[] = []
    let truncated = false
    for (const block of ordered) {
      const text = block.text.replace(/\s+/g, ' ').trim().slice(0, MAX_BLOCK_TEXT)
      const isFocus = focus.has(block.id)
      if (!text && !isFocus) continue
      const line = `${isFocus ? '★' : '-'} [${block.id || '无id'}] (${block.type}) ${text || '（空块）'}`
      if (used + line.length + 1 > MAX_TOTAL_CHARS) {
        truncated = true
        break
      }
      used += line.length + 1
      lines.push(line)
    }
    if (lines.length === 0) continue
    if (truncated) lines.push('…（其余内容已省略）')
    const head = `文档 ${docId}${title ? `「${title}」` : ''}，共 ${blocks.length} 块；★ 为本轮选中块，[id] 即写工具要用的 blockId`
    sections.push(`${head}\n${lines.join('\n')}`)
  }

  if (sections.length === 0) return ''
  return `[选中目标当前内容 · 发问瞬间快照]\n${sections.join('\n\n')}`
}
