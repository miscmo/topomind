/**
 * AgentPatch v1 校验闸（P1 / B 第一段）。
 *
 * 契约对齐 normalizeCardSpecContent：白名单式构造、缺 version 按 v1 容忍、
 * 未知 version 抛错且不回写；模型多吐的字段一律丢弃，绝不透传到写入口。
 * 纯函数：不 mutate 入参、不读 IO、不依赖 React / window / electronAPI。
 */

import {
  CARDSPEC_DOCUMENT_VERSION,
  KNOWN_CARD_COMPONENT_TYPES,
  normalizeCardSpecContent,
  type CardSpecContent,
} from '../../documents/CardSpecDocument/cardSpecTypes'
import {
  AGENT_PATCH_LIMITS,
  AGENT_PATCH_SCHEMA,
  AGENT_PATCH_VERSION,
  ALLOWED_COLOR_TOKENS,
  DOCUMENT_BLOCK_TYPES,
  FORBIDDEN_AGENT_PATCH_OPS,
  STYLE_COLOR_KEYS,
  STYLE_ENUM_KEYS,
  STYLE_ENUM_VALUES,
  STYLE_NUMERIC_KEYS,
  AgentPatchError,
  isAgentPatchOpName,
  type AgentPatch,
  type AgentPatchOp,
  type AgentPatchOpName,
  type DocumentBlock,
  type DocumentMetaPatch,
} from './agentPatchTypes'
import type { KnowledgeNodeStyle } from '../../../types/graph'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/**
 * 房间路径来自 tabStore 的 graphSession.roomPath，**中文知识库名是常见值**
 * （P2 真机冒烟实测为「AI工具冒烟库」）。旧版 ASCII-only 正则会让 node.link /
 * canvas.layout / cardspec.create 三类带 roomPath 的写工具在中文库里全部失效。
 * 改用 Unicode 字母 / 数字，仍禁控制字符、反斜杠与协议前缀；`..` / `://`
 * 的额外拦截在 readRoomPath 里保持不变，路径穿越防护不降级。
 */
const ROOM_PATH_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._\-/ ]{0,255}$/u
const FORBIDDEN_VALUE_PATTERN = /(?:https?:\/\/|:\/\/|data:|javascript:|\.\.\/)/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function fail(code: AgentPatchError['code'], message: string, opIndex?: number): never {
  throw new AgentPatchError(code, message, opIndex)
}

function readString(value: unknown, max: number, field: string, opIndex?: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('schema_invalid', `${field} 必须是非空字符串`, opIndex)
  }
  const text = value.trim()
  if (text.length > max) fail('text_too_long', `${field} 超过 ${max} 字`, opIndex)
  return text
}

function readId(value: unknown, field: string, opIndex?: number): string {
  const id = readString(value, AGENT_PATCH_LIMITS.maxIdLength, field, opIndex)
  if (!ID_PATTERN.test(id)) fail('id_invalid', `${field} 非法: ${id}`, opIndex)
  return id
}

function readRoomPath(value: unknown, opIndex?: number): string {
  const path = readString(value, 256, 'roomPath', opIndex)
  if (!ROOM_PATH_PATTERN.test(path) || path.includes('..') || path.includes('://')) {
    fail('id_invalid', `roomPath 非法: ${path}`, opIndex)
  }
  return path
}

function readPosition(value: unknown, opIndex: number): { x: number; y: number } {
  if (!isPlainObject(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    fail('schema_invalid', 'position 需要有限数值 x / y', opIndex)
  }
  const x = value.x as number
  const y = value.y as number
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) {
    fail('schema_invalid', 'position 超出画布范围', opIndex)
  }
  return { x, y }
}

function readIdList(value: unknown, field: string, opIndex: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > AGENT_PATCH_LIMITS.maxNodeIds) {
    fail('schema_invalid', `${field} 必须是 1..${AGENT_PATCH_LIMITS.maxNodeIds} 项数组`, opIndex)
  }
  const ids = value.map((item) => readId(item, field, opIndex))
  return Array.from(new Set(ids))
}

function readBlocks(value: unknown, opIndex: number, depth = 0): DocumentBlock[] {
  if (!Array.isArray(value)) fail('schema_invalid', 'blocks 必须是数组', opIndex)
  if (value.length > AGENT_PATCH_LIMITS.maxBlocksPerOp) {
    fail('blocks_limit', `单次文档块超过 ${AGENT_PATCH_LIMITS.maxBlocksPerOp}`, opIndex)
  }
  if (depth > AGENT_PATCH_LIMITS.maxBlockDepth) {
    fail('schema_invalid', '文档块嵌套过深', opIndex)
  }
  return value.map((raw, blockIndex) => {
    if (!isPlainObject(raw)) fail('schema_invalid', `blocks[${blockIndex}] 非对象`, opIndex)
    const type = raw.type
    if (typeof type !== 'string' || !(DOCUMENT_BLOCK_TYPES as readonly string[]).includes(type)) {
      fail('schema_invalid', `blocks[${blockIndex}].type 不在白名单`, opIndex)
    }
    const block: DocumentBlock = { type: type as DocumentBlock['type'] }
    if (raw.id !== undefined) block.id = readId(raw.id, `blocks[${blockIndex}].id`, opIndex)
    if (raw.text !== undefined) {
      if (typeof raw.text !== 'string') fail('schema_invalid', `blocks[${blockIndex}].text 非字符串`, opIndex)
      if (raw.text.length > AGENT_PATCH_LIMITS.maxTextLength) {
        fail('text_too_long', `blocks[${blockIndex}].text 超过 ${AGENT_PATCH_LIMITS.maxTextLength} 字`, opIndex)
      }
      if (FORBIDDEN_VALUE_PATTERN.test(raw.text)) {
        fail('schema_invalid', `blocks[${blockIndex}].text 含远程 URL / 脚本 / 任意色值`, opIndex)
      }
      block.text = raw.text
    }
    if (raw.level !== undefined) {
      if (typeof raw.level !== 'number' || !Number.isInteger(raw.level) || raw.level < 1 || raw.level > 6) {
        fail('schema_invalid', `blocks[${blockIndex}].level 必须是 1..6`, opIndex)
      }
      block.level = raw.level
    }
    if (raw.children !== undefined) {
      block.children = readBlocks(raw.children, opIndex, depth + 1)
    }
    return block
  })
}

function readMetaPatch(value: unknown, opIndex: number): DocumentMetaPatch {
  if (!isPlainObject(value)) fail('schema_invalid', 'document.update_meta.patch 非对象', opIndex)
  const patch: DocumentMetaPatch = {}
  if (value.title !== undefined) patch.title = readString(value.title, AGENT_PATCH_LIMITS.maxTitleLength, 'patch.title', opIndex)
  if (value.summary !== undefined) patch.summary = readString(value.summary, AGENT_PATCH_LIMITS.maxTextLength, 'patch.summary', opIndex)
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > AGENT_PATCH_LIMITS.maxTags) {
      fail('schema_invalid', 'patch.tags 超过上限', opIndex)
    }
    patch.tags = value.tags.map((tag) => readString(tag, 64, 'patch.tags[]', opIndex))
  }
  if (Object.keys(patch).length === 0) fail('schema_invalid', 'document.update_meta.patch 为空', opIndex)
  return patch
}

function readColor(value: unknown, field: string, opIndex: number): string {
  if (typeof value !== 'string' || !(ALLOWED_COLOR_TOKENS as readonly string[]).includes(value)) {
    fail('color_invalid', `${field} 只允许 token 引用，拒绝任意 hex / CSS / URL`, opIndex)
  }
  return value
}

function readStylePatch(value: unknown, opIndex: number): Partial<KnowledgeNodeStyle> {
  if (!isPlainObject(value)) fail('schema_invalid', 'node.style.patch 非对象', opIndex)
  const patch: Record<string, unknown> = {}
  for (const key of STYLE_NUMERIC_KEYS) {
    if (value[key] === undefined) continue
    const number = value[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 96) {
      fail('schema_invalid', `${key} 必须是 0..96 的数值`, opIndex)
    }
    patch[key] = number
  }
  for (const key of STYLE_COLOR_KEYS) {
    if (value[key] === undefined) continue
    patch[key] = readColor(value[key], key, opIndex)
  }
  for (const key of STYLE_ENUM_KEYS) {
    if (value[key] === undefined) continue
    const enumValue = value[key]
    if (typeof enumValue !== 'string' || !(STYLE_ENUM_VALUES as readonly string[]).includes(enumValue)) {
      fail('schema_invalid', `${key} 值非法`, opIndex)
    }
    if (key === 'headerFontWeight' && enumValue === 'italic') fail('schema_invalid', 'headerFontWeight 非法', opIndex)
    if (key === 'headerFontStyle' && enumValue === 'bold') fail('schema_invalid', 'headerFontStyle 非法', opIndex)
    patch[key] = enumValue
  }
  if (Object.keys(patch).length === 0) fail('schema_invalid', 'node.style.patch 为空或全部为未登记字段', opIndex)
  return patch as Partial<KnowledgeNodeStyle>
}

/** CardSpec 载荷再过一次真实归一化，并额外拒绝 html / 未知组件 / 远程 URL。 */
function readCardSpec(raw: unknown, fallbackTitle: string, opIndex: number): CardSpecContent {
  if (!isPlainObject(raw)) fail('cardspec_invalid', 'CardSpec 载荷非对象', opIndex)
  if (raw.version !== undefined && raw.version !== CARDSPEC_DOCUMENT_VERSION) {
    fail('cardspec_invalid', `CardSpec 版本不受支持: ${String(raw.version)}`, opIndex)
  }
  const spec: CardSpecContent = (() => {
    try {
      return normalizeCardSpecContent(raw, fallbackTitle)
    } catch {
      return fail('cardspec_invalid', 'CardSpec 归一化失败', opIndex)
    }
  })()
  for (const component of spec.components) {
    if (component.type === 'html' || !(KNOWN_CARD_COMPONENT_TYPES as readonly string[]).includes(component.type)) {
      fail('cardspec_invalid', `CardSpec 组件类型不被允许: ${component.type}`, opIndex)
    }
    const propsText = JSON.stringify(component.props ?? {})
    if (/(?:https?:\/\/|data:|javascript:|#[0-9a-fA-F]{6}\b)/.test(propsText)) {
      fail('cardspec_invalid', 'CardSpec props 含远程 URL / 脚本 / 任意色值', opIndex)
    }
  }
  return spec
}

function readRevision(value: unknown): AgentPatch['baseRevision'] {
  if (value === undefined) return {}
  if (!isPlainObject(value)) fail('base_revision_invalid', 'baseRevision 非对象')
  const revision: AgentPatch['baseRevision'] = {}
  if (value.roomRev !== undefined) {
    if (typeof value.roomRev !== 'number' || !Number.isInteger(value.roomRev) || value.roomRev < 0) {
      fail('base_revision_invalid', 'baseRevision.roomRev 必须是非负整数')
    }
    revision.roomRev = value.roomRev
  }
  if (value.documentRev !== undefined) {
    const docRev = value.documentRev
    if (!isPlainObject(docRev) || Object.keys(docRev).length > AGENT_PATCH_LIMITS.maxDocumentRevEntries) {
      fail('base_revision_invalid', 'baseRevision.documentRev 非法或超过上限')
    }
    const entries: Record<string, number> = {}
    for (const [key, rev] of Object.entries(docRev)) {
      if (!ID_PATTERN.test(key) || typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) {
        fail('base_revision_invalid', `baseRevision.documentRev[${key}] 非法`)
      }
      entries[key] = rev
    }
    revision.documentRev = entries
  }
  return revision
}

function normalizeOp(raw: unknown, index: number): AgentPatchOp {
  if (!isPlainObject(raw)) fail('schema_invalid', `ops[${index}] 非对象`, index)
  const name = raw.op
  if (typeof name === 'string' && (FORBIDDEN_AGENT_PATCH_OPS as readonly string[]).includes(name)) {
    fail('op_forbidden', `破坏性 op 永不开放: ${name}`, index)
  }
  if (!isAgentPatchOpName(name)) fail('op_unknown', `未知 op: ${String(name)}`, index)
  const op = name as AgentPatchOpName

  switch (op) {
    case 'document.insert_blocks': {
      const blocks = readBlocks(raw.blocks, index)
      if (blocks.length === 0) fail('schema_invalid', 'insert_blocks 不能为空', index)
      return {
        op,
        documentId: readId(raw.documentId, 'documentId', index),
        ...(raw.afterBlockId !== undefined ? { afterBlockId: readId(raw.afterBlockId, 'afterBlockId', index) } : {}),
        blocks,
      }
    }
    case 'document.replace_blocks': {
      const blocks = readBlocks(raw.blocks, index)
      if (blocks.length === 0) fail('schema_invalid', 'replace_blocks 不能为空', index)
      return {
        op,
        documentId: readId(raw.documentId, 'documentId', index),
        blockIds: readIdList(raw.blockIds, 'blockIds', index),
        blocks,
      }
    }
    case 'document.update_meta':
      return {
        op,
        documentId: readId(raw.documentId, 'documentId', index),
        patch: readMetaPatch(raw.patch, index),
      }
    case 'node.create':
      return {
        op,
        roomPath: readRoomPath(raw.roomPath, index),
        title: readString(raw.title, AGENT_PATCH_LIMITS.maxTitleLength, 'title', index),
        position: readPosition(raw.position, index),
        ...(raw.parentId !== undefined ? { parentId: readId(raw.parentId, 'parentId', index) } : {}),
      }
    case 'node.rename':
      return {
        op,
        nodeId: readId(raw.nodeId, 'nodeId', index),
        title: readString(raw.title, AGENT_PATCH_LIMITS.maxTitleLength, 'title', index),
      }
    case 'node.style':
      return {
        op,
        nodeIds: readIdList(raw.nodeIds, 'nodeIds', index),
        patch: readStylePatch(raw.patch, index),
      }
    case 'node.tree_order': {
      const order = readIdList(raw.order, 'order', index)
      if (order.length !== (raw.order as unknown[]).length) {
        fail('schema_invalid', 'node.tree_order.order 存在重复 id', index)
      }
      return { op, roomPath: readRoomPath(raw.roomPath, index), order }
    }
    case 'edge.create': {
      const relation = raw.relation
      if (relation !== 'related' && relation !== 'subordinate') {
        fail('schema_invalid', 'edge.create.relation 非法', index)
      }
      const weight = raw.weight === undefined ? 'main' : raw.weight
      if (weight !== 'main' && weight !== 'minor') fail('schema_invalid', 'edge.create.weight 非法', index)
      return {
        op,
        roomPath: readRoomPath(raw.roomPath, index),
        source: readId(raw.source, 'source', index),
        target: readId(raw.target, 'target', index),
        relation,
        weight,
      }
    }
    case 'edge.delete':
      return { op, edgeId: readId(raw.edgeId, 'edgeId', index) }
    case 'cardspec.create': {
      const title = readString(raw.title, AGENT_PATCH_LIMITS.maxTitleLength, 'title', index)
      return {
        op,
        roomPath: readRoomPath(raw.roomPath, index),
        title,
        spec: readCardSpec(raw.spec, title, index),
        ...(raw.nodeId !== undefined ? { nodeId: readId(raw.nodeId, 'nodeId', index) } : {}),
      }
    }
    case 'cardspec.update':
      return {
        op,
        documentId: readId(raw.documentId, 'documentId', index),
        spec: readCardSpec(raw.spec, '', index),
      }
    case 'canvas.layout': {
      const algorithm = raw.algorithm
      if (algorithm !== 'grid' && algorithm !== 'tree') fail('schema_invalid', 'canvas.layout.algorithm 非法', index)
      return {
        op,
        roomPath: readRoomPath(raw.roomPath, index),
        algorithm,
        ...(raw.nodeIds !== undefined ? { nodeIds: readIdList(raw.nodeIds, 'nodeIds', index) } : {}),
      }
    }
    default:
      return fail('op_unknown', `未知 op: ${String(op)}`, index)
  }
}

/**
 * 唯一校验入口：合法则返回一个全新的 AgentPatch，非法抛 AgentPatchError 且不回写。
 */
export function normalizeAgentPatch(raw: unknown): AgentPatch {
  if (!isPlainObject(raw)) fail('schema_invalid', 'AgentPatch 非对象')
  if (raw.schema !== undefined && raw.schema !== AGENT_PATCH_SCHEMA) {
    fail('schema_invalid', `schema 不受支持: ${String(raw.schema)}`)
  }
  if (raw.version !== undefined && raw.version !== AGENT_PATCH_VERSION) {
    fail('version_invalid', `AgentPatch 版本不受支持: ${String(raw.version)}`)
  }
  const taskId = readId(raw.taskId, 'taskId')
  if (!Array.isArray(raw.ops)) fail('schema_invalid', 'ops 必须是数组')
  if (raw.ops.length > AGENT_PATCH_LIMITS.maxOps) {
    fail('ops_limit', `ops 超过 ${AGENT_PATCH_LIMITS.maxOps} 上限`)
  }
  const ops = raw.ops.map((item, index) => normalizeOp(item, index))
  const patch: AgentPatch = {
    schema: AGENT_PATCH_SCHEMA,
    version: AGENT_PATCH_VERSION,
    taskId,
    baseRevision: readRevision(raw.baseRevision),
    ops,
  }
  if (raw.reason !== undefined) {
    patch.reason = readString(raw.reason, AGENT_PATCH_LIMITS.maxReasonLength, 'reason')
  }
  return patch
}
