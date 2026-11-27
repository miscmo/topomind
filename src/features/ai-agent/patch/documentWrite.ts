/**
 * AgentPatch v1 文档 / CardSpec 写入的纯函数层（P2 遗留补齐）。
 *
 * 设计依据：docs/design/native-ai-agent-design.md §5 / §6.2 / §19.4。
 * 本文件刻意不 import React / window / storage / 任何 IO，必须能被契约门禁
 * 用 esbuild 打包后真跑。它只做两件事：
 *   1. 把「白名单 DocumentBlock」翻译成产品真实的 BlockNote 块结构；
 *   2. 把「op + 预览时抓取的文档状态」变成一份完整的、可直接 writeTopoDocument
 *      的规范化载荷，并带上基准摘要供 commit 阶段做并发校验。
 *
 * 安全口径（对应设计文档「绝不静默覆盖」）：
 *   - 目标文档有未保存草稿 → 预览阶段即阻断；
 *   - 预览到提交之间磁盘内容变化 → commit 重读比对摘要后拒绝，零写入；
 *   - 载荷全部过产品自己的 normalize 闸，AI 无法塞入任意脚本 / HTML / 远程 URL。
 */

import {
  ensureStableBlockIds,
  newSmartDocumentBlockId,
  normalizeSmartDocumentContent,
  type BlockNoteBlock,
  type SmartDocumentContent,
} from '../../documents/SmartDocumentEditor/smartDocumentTypes'
import { normalizeCardSpecContent } from '../../documents/CardSpecDocument/cardSpecTypes'
import {
  AgentPatchError,
  type AgentDocumentState,
  type AgentDocumentWrite,
  type AgentPatchErrorCode,
  type AgentPatchOp,
  type DocumentBlock,
} from './agentPatchTypes'

export type { AgentDocumentState, AgentDocumentWrite, AgentDocumentWriteOutcome, AgentDocumentWriteKind } from './agentPatchTypes'

export interface DocumentWritePreview {
  write: AgentDocumentWrite
  before: unknown
  after: unknown
  affectedCount: number
  summary: string
  targetId: string
}

/** 与 dryRun 的 shortHash 同口径；先做键排序，保证字段顺序变化不改变摘要。 */
export function stableContentDigest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input && typeof input === 'object') {
      const source = input as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(source).sort()) result[key] = canonical(source[key])
      return result
    }
    return input ?? null
  }
  const text = JSON.stringify(canonical(value))
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 12)
}

export function readDocumentBlockIds(content: unknown): string[] {
  if (!content || typeof content !== 'object') return []
  const blocks = (content as Record<string, unknown>).blocks
  if (!Array.isArray(blocks)) return []
  // 与 document.read 摘要、buildSmartWrite 的 base.blocks 共用同一套确定性补齐，
  // 否则旧档缺 id 时预览里的 blockIds 会是空的，AI 的 replace_blocks 会被误判为找不到目标。
  return ensureStableBlockIds(blocks as BlockNoteBlock[])
    .map((block) => (block && typeof block === 'object' ? (block as Record<string, unknown>).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** 房间相对路径拼接：与 domain/graph/path-utils 的 joinRefs 同口径，避免引入路径库。 */
export function joinRoomChildRef(roomPath: string, childId: string): string {
  const clean = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  return clean([clean(roomPath), clean(childId)].filter(Boolean).join('/'))
}

/** 白名单 DocumentBlock → 产品真实 BlockNote 块。所有类型都落在本应用 schema 内。 */
export function toBlockNoteBlock(block: DocumentBlock): BlockNoteBlock {
  const text = typeof block.text === 'string' ? block.text : ''
  const result: BlockNoteBlock = {}
  switch (block.type) {
    case 'heading':
      result.type = 'heading'
      result.props = { level: Math.min(3, Math.max(1, Math.trunc(block.level ?? 2) || 2)) }
      result.content = text
      break
    case 'bulletListItem':
      result.type = 'bulletListItem'
      result.content = text
      break
    case 'numberedListItem':
      result.type = 'numberedListItem'
      result.content = text
      break
    case 'quote':
      result.type = 'quote'
      result.content = text
      break
    case 'code':
      result.type = 'codeBlock'
      result.props = { language: '' }
      result.content = text
      break
    case 'divider':
      // 本应用 schema 没有 divider 块（既有 legacy 归一化也降级为段落 '---'）。
      result.type = 'paragraph'
      result.content = '---'
      break
    default:
      result.type = 'paragraph'
      result.content = text
      break
  }
  // AI 新建块落盘瞬间就要有稳定 id，否则下一次 document.read 找不到它，
  // 用户也没法「选中这个块再让 AI 改」。已有 id 原样保留（幂等）。
  result.id = block.id || newSmartDocumentBlockId()
  if (Array.isArray(block.children) && block.children.length > 0) {
    result.children = block.children.map(toBlockNoteBlock)
  }
  return result
}

function fail(code: AgentPatchErrorCode, message: string): never {
  throw new AgentPatchError(code, message)
}

function requireState(op: AgentPatchOp, states: Record<string, AgentDocumentState>): AgentDocumentState {
  const documentId = 'documentId' in op ? op.documentId : ''
  const state = states[documentId]
  if (!state) fail('target_not_found', `目标文档不存在或未解析到所在卡片: ${documentId}`)
  if (state.dirty) fail('document_dirty', `文档「${state.title}」有未保存草稿，请先保存后再让 AI 写入`)
  return state
}

function summarizeBlocks(op: AgentPatchOp): unknown {
  if (op.op === 'document.insert_blocks' || op.op === 'document.replace_blocks') {
    return { count: op.blocks.length, types: op.blocks.slice(0, 3).map((block) => block.type) }
  }
  if (op.op === 'document.update_meta') return { keys: Object.keys(op.patch) }
  if (op.op === 'cardspec.create' || op.op === 'cardspec.update') {
    return { title: op.spec.title, components: op.spec.components.length }
  }
  return null
}

function withAiMark(content: Record<string, unknown>): Record<string, unknown> {
  const metadata = { ...(content.metadata as Record<string, unknown> | undefined) }
  metadata.generatedBy = 'ai'
  return { ...content, metadata }
}

function buildSmartWrite(
  op: Extract<AgentPatchOp, { op: 'document.insert_blocks' | 'document.replace_blocks' | 'document.update_meta' }>,
  state: AgentDocumentState,
): { content: SmartDocumentContent; affectedCount: number } {
  const base = normalizeSmartDocumentContent(state.content, state.title)
  if (op.op === 'document.update_meta') {
    const metadata = { ...(base.metadata ?? {}) }
    if (typeof op.patch.summary === 'string') metadata.summary = op.patch.summary
    if (Array.isArray(op.patch.tags)) metadata.tags = op.patch.tags
    return {
      content: normalizeSmartDocumentContent({
        ...base,
        title: op.patch.title?.trim() || base.title,
        metadata,
      }, state.title),
      affectedCount: Object.keys(op.patch).length,
    }
  }
  const inserted = op.blocks.map(toBlockNoteBlock)
  let blocks: BlockNoteBlock[]
  if (op.op === 'document.insert_blocks') {
    blocks = [...base.blocks]
    const anchor = op.afterBlockId
      ? blocks.findIndex((block) => typeof block.id === 'string' && block.id === op.afterBlockId)
      : -1
    if (anchor >= 0) blocks.splice(anchor + 1, 0, ...inserted)
    else blocks.push(...inserted)
  } else {
    const targets = new Set(op.blockIds)
    const first = base.blocks.findIndex((block) => typeof block.id === 'string' && targets.has(block.id))
    if (first < 0) fail('target_not_found', `待替换的块 id 均不存在: ${op.blockIds.join(',')}`)
    blocks = base.blocks.flatMap((block, index) => {
      if (typeof block.id !== 'string' || !targets.has(block.id)) return [block]
      return index === first ? inserted : []
    })
  }
  return {
    content: normalizeSmartDocumentContent({ ...base, blocks }, state.title),
    affectedCount: op.blocks.length,
  }
}

/**
 * 单个文档类 op 的纯变换。返回可直接写盘的完整载荷；任何不安全情况抛 AgentPatchError，
 * 由 dryRun 降级为一条 blocked 预览项，绝不拖垮同一轮里的其它 ready 项。
 */
export function buildDocumentWrite(
  op: AgentPatchOp,
  opId: string,
  states: Record<string, AgentDocumentState>,
  roomPath: string,
  index: number,
  taskId: string,
): DocumentWritePreview {
  const before = (state?: AgentDocumentState) => state
    ? { id: state.documentId, title: state.title, blockCount: state.blockCount, digest: state.digest }
    : null
  const after = () => summarizeBlocks(op)

  if (op.op === 'cardspec.create') {
    const nodeId = op.nodeId || `agent-n-${index}-${taskId.slice(-6)}`
    const content = withAiMark(normalizeCardSpecContent(op.spec, op.title) as unknown as Record<string, unknown>)
    const write: AgentDocumentWrite = {
      opId,
      documentId: `pending-${nodeId}`,
      cardPath: joinRoomChildRef(op.roomPath, nodeId),
      kind: 'cardspec-create',
      baseDigest: '',
      content,
      title: op.title,
      nodeId,
      roomPath: op.roomPath || roomPath,
    }
    return {
      write,
      before: null,
      after: after(),
      affectedCount: 1,
      summary: `新建 CardSpec 容器「${op.title}」并写入 ${op.spec.components.length} 个组件`,
      targetId: nodeId,
    }
  }

  const state = requireState(op, states)
  const expectedKind = op.op === 'cardspec.update' ? 'cardspec' : 'smart'
  if (state.type !== expectedKind) {
    fail('document_target_invalid', `文档 ${state.documentId} 类型为 ${state.type}，不接受 ${op.op}`)
  }

  let content: Record<string, unknown>
  let affectedCount: number
  if (op.op === 'cardspec.update') {
    content = withAiMark(normalizeCardSpecContent(op.spec, state.title) as unknown as Record<string, unknown>)
    affectedCount = op.spec.components.length
  } else if (
    op.op === 'document.insert_blocks'
    || op.op === 'document.replace_blocks'
    || op.op === 'document.update_meta'
  ) {
    const built = buildSmartWrite(op, state)
    // 与 CardSpec 同口径：AI 写入带来源标记，且 normalize 会透传，
    // 用户下一次敲键触发的整篇 autosave 不会把这个标记冲掉。
    content = withAiMark(built.content as unknown as Record<string, unknown>)
    affectedCount = built.affectedCount
  } else {
    fail('op_unknown', `非文档类 op 不能产生 documentWrite: ${op.op}`)
  }

  const write: AgentDocumentWrite = {
    opId,
    documentId: state.documentId,
    cardPath: state.cardPath,
    kind: op.op === 'cardspec.update' ? 'cardspec' : 'smart',
    baseDigest: state.digest,
    content,
    title: op.op === 'document.update_meta' ? op.patch.title : undefined,
  }
  return {
    write,
    before: before(state),
    after: { ...(after() as Record<string, unknown>), blockCountAfter: readDocumentBlockIds(content).length },
    affectedCount,
    summary: `${op.op} → ${state.title}（写入 ${affectedCount} 项，提交时校验版本）`,
    targetId: state.documentId,
  }
}
