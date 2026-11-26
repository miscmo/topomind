/**
 * AgentPatch v1 类型契约（P1 / B）。
 *
 * 设计依据：docs/design/native-ai-agent-design.md §5 / §6.2。
 * 本文件是纯类型 + 编译期常量：禁止 import React、window、electronAPI、任何 IO，
 * 必须能被门禁脚本用 esbuild 打包后真跑。
 *
 * 三段执行：normalizeAgentPatch(raw) → dryRunAgentPatch(patch, snapshot) → commitAgentPatch(plan, selectedOpIds, api)。
 * 只有第三段允许产生副作用；前两段是纯函数。
 */

import type { CardSpecContent } from '../../documents/CardSpecDocument/cardSpecTypes'
import type { KnowledgeNodeStyle } from '../../../types/graph'

export const AGENT_PATCH_SCHEMA = 'topomind.agent-patch'
export const AGENT_PATCH_VERSION = 1
export const AGENT_PATCH_PLAN_SCHEMA = 'topomind.agent-patch-plan'
export const AGENT_PATCH_PLAN_VERSION = 1

/** 与 §5 校验规则、CardSpec 既有阈值对齐。 */
export const AGENT_PATCH_LIMITS = {
  maxOps: 50,
  maxBlocksPerOp: 200,
  maxTextLength: 4000,
  maxTitleLength: 200,
  maxReasonLength: 500,
  maxIdLength: 128,
  maxDocumentRevEntries: 64,
  maxNodeIds: 200,
  maxBlockDepth: 3,
  maxTags: 12,
} as const

/** 12 类开放 op。破坏性 op 不在此表，且命中 FORBIDDEN_AGENT_PATCH_OPS 直接拒绝。 */
export const AGENT_PATCH_OPS = [
  'document.insert_blocks',
  'document.replace_blocks',
  'document.update_meta',
  'node.create',
  'node.rename',
  'node.style',
  'node.tree_order',
  'edge.create',
  'edge.delete',
  'cardspec.create',
  'cardspec.update',
  'canvas.layout',
] as const
export type AgentPatchOpName = typeof AGENT_PATCH_OPS[number]

/** §6.1「永不开放」三项；即使带预览也不接受。 */
export const FORBIDDEN_AGENT_PATCH_OPS = [
  'node.delete',
  'node.move_room',
  'document.clear',
] as const

/** 图类 op 由 P1 的 commit 直接执行；其余 op 产出预览但等 P2 接编辑器 / 容器写入口。 */
export const GRAPH_PATCH_OPS = [
  'node.create',
  'node.rename',
  'node.style',
  'node.tree_order',
  'edge.create',
  'edge.delete',
  'canvas.layout',
] as const
export type GraphPatchOpName = typeof GRAPH_PATCH_OPS[number]

/** 颜色只接受 token 引用或受限中性值；任意 hex / CSS / URL / 路径一律拒绝。 */
export const ALLOWED_COLOR_TOKENS = [
  'token:primary', 'token:accent', 'token:success', 'token:warning',
  'token:danger', 'token:muted', 'token:surface', 'token:text',
  'transparent', 'none', 'inherit',
] as const

export const STYLE_NUMERIC_KEYS = ['headerFontSize', 'bodyFontSize', 'borderWidth'] as const
export const STYLE_COLOR_KEYS = ['headerColor', 'headerBackgroundColor', 'borderColor'] as const
export const STYLE_ENUM_KEYS = ['headerFontWeight', 'headerFontStyle'] as const
export const STYLE_ENUM_VALUES = ['normal', 'bold', 'italic'] as const

export const DOCUMENT_BLOCK_TYPES = [
  'paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'quote', 'code', 'divider',
] as const
export type DocumentBlockType = typeof DOCUMENT_BLOCK_TYPES[number]

/** 文档块的最小白名单结构（BlockNote 块的一期子集，不解析自由文本）。 */
export interface DocumentBlock {
  id?: string
  type: DocumentBlockType
  text?: string
  level?: number
  children?: DocumentBlock[]
}

export interface DocumentMetaPatch {
  title?: string
  summary?: string
  tags?: string[]
}

export interface NodePosition {
  x: number
  y: number
}

export type AgentPatchOp =
  | { op: 'document.insert_blocks'; documentId: string; afterBlockId?: string; blocks: DocumentBlock[] }
  | { op: 'document.replace_blocks'; documentId: string; blockIds: string[]; blocks: DocumentBlock[] }
  | { op: 'document.update_meta'; documentId: string; patch: DocumentMetaPatch }
  | { op: 'node.create'; roomPath: string; title: string; position: NodePosition; parentId?: string }
  | { op: 'node.rename'; nodeId: string; title: string }
  | { op: 'node.style'; nodeIds: string[]; patch: Partial<KnowledgeNodeStyle> }
  | { op: 'node.tree_order'; roomPath: string; order: string[] }
  | { op: 'edge.create'; roomPath: string; source: string; target: string; relation: 'related' | 'subordinate'; weight?: 'main' | 'minor' }
  | { op: 'edge.delete'; edgeId: string }
  | { op: 'cardspec.create'; roomPath: string; title: string; spec: CardSpecContent; nodeId?: string }
  | { op: 'cardspec.update'; documentId: string; spec: CardSpecContent }
  | { op: 'canvas.layout'; roomPath: string; algorithm: 'grid' | 'tree'; nodeIds?: string[] }

export interface AgentPatchRevision {
  /** documentId → 该文档的 draftVersion / content revision。 */
  documentRev?: Record<string, number>
  /** 房间图修订号（由 Workspace API 的快照提供）。 */
  roomRev?: number
}

export interface AgentPatch {
  schema: typeof AGENT_PATCH_SCHEMA
  version: typeof AGENT_PATCH_VERSION
  taskId: string
  reason?: string
  baseRevision: AgentPatchRevision
  ops: AgentPatchOp[]
}

/** 预览阶段由渲染层异步抓取的文档状态：不进纯函数以外的任何地方。 */
export interface AgentDocumentState {
  documentId: string
  cardPath: string
  type: string
  title: string
  digest: string
  blockIds: string[]
  blockCount: number
  /** 右栏存在未保存草稿时为 true，此时禁止 AI 写入（整篇覆盖风险）。 */
  dirty: boolean
  content: unknown
}

export type AgentDocumentWriteKind = 'smart' | 'cardspec' | 'cardspec-create'

/** 一条可提交的文档写入指令：content 是完整规范化载荷，不是增量 diff。 */
export interface AgentDocumentWrite {
  opId: string
  /** cardspec-create 时是占位 id，提交成功后由返回值给出真实 id。 */
  documentId: string
  cardPath: string
  kind: AgentDocumentWriteKind
  /** 预览时的内容摘要；cardspec-create 为 ''（新建无需比对）。 */
  baseDigest: string
  content: Record<string, unknown>
  title?: string
  nodeId?: string
  roomPath?: string
}

export interface AgentDocumentWriteOutcome {
  opId: string
  documentId: string
  cardPath: string
  ok: boolean
  code?: AgentPatchErrorCode
  message?: string
}

export type AgentPatchErrorCode =
  | 'schema_invalid'
  | 'version_invalid'
  | 'op_unknown'
  | 'op_forbidden'
  | 'ops_limit'
  | 'id_invalid'
  | 'text_too_long'
  | 'color_invalid'
  | 'cardspec_invalid'
  | 'blocks_limit'
  | 'base_revision_invalid'
  | 'target_not_found'
  | 'cross_room_ref'
  | 'document_revision_mismatch'
  | 'document_state_unavailable'
  | 'document_dirty'
  | 'document_target_invalid'
  | 'document_write_failed'
  | 'cardspec_create_failed'
  | 'room_revision_mismatch'
  | 'snapshot_stale'
  | 'no_selected_ops'
  | 'op_blocked'
  | 'document_write_not_wired'
  | 'cardspec_write_not_wired'
  | 'guard_rejected'
  | 'commit_failed'

export class AgentPatchError extends Error {
  readonly code: AgentPatchErrorCode
  readonly opIndex?: number

  constructor(code: AgentPatchErrorCode, message: string, opIndex?: number) {
    super(message)
    this.name = 'AgentPatchError'
    this.code = code
    this.opIndex = opIndex
  }
}

/** dryRun 使用的冻结快照：纯数据，不从 React / window / LOD 可见节点取。 */
export interface SnapshotNode {
  id: string
  label: string
  roomPath: string
  position: NodePosition
  parentId?: string
  style?: Record<string, unknown>
  treeOrder?: number
  containerType?: string
  linkedDocumentIds?: string[]
}

export interface SnapshotEdge {
  id: string
  source: string
  target: string
  roomPath: string
  relation: 'related' | 'subordinate'
  weight: 'main' | 'minor'
}

export interface SnapshotDocument {
  id: string
  revision: number
  title?: string
  blockIds: string[]
  blockCount: number
}

export interface WorkspaceSnapshot {
  roomPath: string
  roomRev: number
  nodes: SnapshotNode[]
  edges: SnapshotEdge[]
  documents: SnapshotDocument[]
}

export type PatchRisk = 'low' | 'medium' | 'high'
export type PatchItemStatus = 'ready' | 'blocked'

export interface PatchPreviewItem {
  /** `${index}:${op}`，commit 的勾选单位。 */
  opId: string
  index: number
  op: AgentPatchOpName
  summary: string
  before: unknown
  after: unknown
  affectedCount: number
  risk: PatchRisk
  status: PatchItemStatus
  blockedReason?: AgentPatchErrorCode
  targetId?: string
  /** 图类 op 的纯变换结果，commit 直接消费；文档类 op 为 null。 */
  graphDelta?: {
    nodes: SnapshotNode[]
    edges: SnapshotEdge[]
  }
  /** 文档 / CardSpec 类 op 的完整待写载荷，commit 直接消费；图类 op 为 undefined。 */
  documentWrite?: AgentDocumentWrite
}

export interface PatchPlan {
  schema: typeof AGENT_PATCH_PLAN_SCHEMA
  version: typeof AGENT_PATCH_PLAN_VERSION
  taskId: string
  items: PatchPreviewItem[]
  warnings: string[]
  totalAffected: number
  readyCount: number
  blockedCount: number
  /** 快照指纹：commit 前重新取快照比对，防止预览后用户又改了图。 */
  snapshotDigest: string
  /** 预览时各目标文档的内容摘要：commit 重读磁盘逐条比对，变化即拒绝。 */
  documentDigests: Record<string, string>
  requiresConfirmation: true
  createdAt: number
}

/** 文档 / CardSpec 类 op（写入需要额外抓取文档状态，与图类 op 分流）。 */
export const DOCUMENT_PATCH_OPS = [
  'document.insert_blocks',
  'document.replace_blocks',
  'document.update_meta',
  'cardspec.create',
  'cardspec.update',
] as const
export type DocumentPatchOpName = typeof DOCUMENT_PATCH_OPS[number]

export function isAgentPatchOpName(value: unknown): value is AgentPatchOpName {
  return typeof value === 'string' && (AGENT_PATCH_OPS as readonly string[]).includes(value)
}

export function isGraphPatchOpName(value: unknown): value is GraphPatchOpName {
  return typeof value === 'string' && (GRAPH_PATCH_OPS as readonly string[]).includes(value)
}

export function isDocumentPatchOpName(value: unknown): value is DocumentPatchOpName {
  return typeof value === 'string' && (DOCUMENT_PATCH_OPS as readonly string[]).includes(value)
}
