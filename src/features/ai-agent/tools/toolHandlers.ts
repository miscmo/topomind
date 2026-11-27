/**
 * P2：工具执行体。
 *
 * 读工具：只消费注入的 ToolRuntime（既有 storage / 全量图快照），不新开 IPC、不读盘。
 * 写工具：纯函数把结构化参数映射成 AgentPatch op，**绝不 commit**；
 *         后续统一走 normalizeAgentPatch → dryRunAgentPatch → 人工勾选 → commitAgentPatch。
 *
 * 模型产出的自由文本只在「块内容」这类业务字段里出现，控制流永远由结构化参数决定；
 * 不解析自然语言指令、不生成 HTML、不执行任意代码。
 */

import type { CardSpecContent } from '../../documents/CardSpecDocument/cardSpecTypes'
import type { AiIndexScope } from '@/core/ai-types'
import type { KnowledgeNodeStyle } from '@/types/graph'
import { buildRetrievalEnvelope } from '../model/contextBuilder'
import type { AgentPatchOp, DocumentBlock } from '../patch/agentPatchTypes'
import type { AgentDelegateResult, ToolHandler, ToolOutcome, ToolRuntime } from './toolTypes'

/** 回灌给模型的单条 tool 结果上限，避免把整篇文档塞爆上下文。 */
export const MAX_TOOL_RESULT_LENGTH = 12000
const MAX_GRAPH_NODES = 200
const MAX_LIST_ITEMS = 60

function result(value: unknown): ToolOutcome {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { kind: 'result', text: text.length > MAX_TOOL_RESULT_LENGTH ? `${text.slice(0, MAX_TOOL_RESULT_LENGTH)}…（结果已截断）` : text }
}

function error(code: string, text: string): ToolOutcome {
  return { kind: 'error', code, text }
}

function asString(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key]
  if (typeof value !== 'string') {
    if (!required) return ''
    throw new Error(`缺少参数 ${key}`)
  }
  return value
}

function asStringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, MAX_LIST_ITEMS * 3)
}

function asBlocks(args: Record<string, unknown>): DocumentBlock[] {
  const raw = args.blocks
  if (!Array.isArray(raw)) throw new Error('缺少参数 blocks')
  return raw as unknown as DocumentBlock[]
}

function asSpec(args: Record<string, unknown>): CardSpecContent {
  // normalizeAgentPatch 会二次跑 normalizeCardSpecContent；这里只做形状传递。
  return args.spec as CardSpecContent
}

/**
 * 写工具 → 单个 AgentPatch op 的纯映射。导出供门禁打包真跑。
 * 抛出的错误由 executeToolCall 转成 error outcome，不会中断整轮会话。
 */
export function mapWriteToolToOp(toolId: string, args: Record<string, unknown>): AgentPatchOp {
  switch (toolId) {
    case 'document.draft':
    case 'document.outline': {
      const op: AgentPatchOp = {
        op: 'document.insert_blocks',
        documentId: asString(args, 'documentId'),
        blocks: asBlocks(args),
      }
      const after = asString(args, 'afterBlockId', false)
      if (after) op.afterBlockId = after
      return op
    }
    case 'document.polish':
      return {
        op: 'document.replace_blocks',
        documentId: asString(args, 'documentId'),
        blockIds: asStringList(args, 'blockIds'),
        blocks: asBlocks(args),
      }
    case 'node.style': {
      const nodeIds = asStringList(args, 'nodeIds')
      if (nodeIds.length === 0) throw new Error('缺少参数 nodeIds')
      const patch = args.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('缺少参数 patch')
      return { op: 'node.style', nodeIds, patch: patch as Partial<KnowledgeNodeStyle> }
    }
    case 'node.create': {
      const position = args.position
      if (!position || typeof position !== 'object' || Array.isArray(position)) throw new Error('缺少参数 position')
      const point = position as Record<string, unknown>
      const op: AgentPatchOp = {
        op: 'node.create',
        roomPath: asString(args, 'roomPath'),
        title: asString(args, 'title'),
        position: { x: Number(point.x) || 0, y: Number(point.y) || 0 },
      }
      const parentId = asString(args, 'parentId', false)
      if (parentId) op.parentId = parentId
      return op
    }
    case 'node.rename':
      return { op: 'node.rename', nodeId: asString(args, 'nodeId'), title: asString(args, 'title') }
    case 'node.link': {
      const relation = args.relation === 'subordinate' ? 'subordinate' : 'related'
      const op: AgentPatchOp = {
        op: 'edge.create',
        roomPath: asString(args, 'roomPath'),
        source: asString(args, 'source'),
        target: asString(args, 'target'),
        relation,
      }
      if (args.weight === 'minor' || args.weight === 'main') op.weight = args.weight
      return op
    }
    case 'canvas.layout': {
      const algorithm = args.algorithm === 'tree' ? 'tree' : 'grid'
      const op: AgentPatchOp = { op: 'canvas.layout', roomPath: asString(args, 'roomPath'), algorithm }
      const nodeIds = asStringList(args, 'nodeIds')
      if (nodeIds.length > 0) op.nodeIds = nodeIds
      return op
    }
    case 'cardspec.generate': {
      const spec = asSpec(args)
      const documentId = asString(args, 'documentId', false)
      if (documentId) return { op: 'cardspec.update', documentId, spec }
      const op: AgentPatchOp = {
        op: 'cardspec.create',
        roomPath: asString(args, 'roomPath'),
        title: asString(args, 'title', false) || 'AI 生成卡片',
        spec,
      }
      const nodeId = asString(args, 'nodeId', false)
      if (nodeId) op.nodeId = nodeId
      return op
    }
    default:
      throw new Error(`未知写工具 ${toolId}`)
  }
}

const WRITE_TOOL_IDS = new Set([
  'document.draft', 'document.polish', 'document.outline',
  'node.style', 'node.create', 'node.rename', 'node.link',
  'canvas.layout', 'cardspec.generate',
])

export function isWriteToolId(toolId: string): boolean {
  return WRITE_TOOL_IDS.has(toolId)
}

export function createWriteHandler(toolId: string): ToolHandler {
  return async (args) => {
    try {
      const op = mapWriteToolToOp(toolId, args)
      return {
        kind: 'patch',
        text: `已生成 1 项「${op.op}」变更建议，等待用户预览确认后才会写入。`,
        ops: [op],
      }
    } catch (cause) {
      return error('tool_args_invalid', cause instanceof Error ? cause.message : '工具参数不合法')
    }
  }
}

// ---------------------------------------------------------------------------
// 只读工具执行体
// ---------------------------------------------------------------------------

interface ReadHandlerMap {
  [toolId: string]: (args: Record<string, unknown>, runtime: ToolRuntime) => Promise<ToolOutcome>
}

/**
 * P3 / D：知识库问答。主进程只做本地倒排检索，结果必须经
 * buildRetrievalEnvelope()（§8 唯一外发组装点）裁剪与编号后才回灌给模型；
 * docId / cardPath 只留在 references 供渲染层做 [ref:i] → 文档跳转，不外发。
 */
function createKbAskHandler(): ToolHandler {
  return async (args, runtime) => {
    if (!runtime.index) return error('kb_index_unavailable', '本地检索服务未接入')
    try {
      const question = asString(args, 'question').trim().slice(0, 1000)
      if (!question) return error('tool_args_invalid', '问题不能为空')
      const scope: AiIndexScope = args.scope === 'kb' || args.scope === 'room' ? args.scope : 'all'
      const topK = Math.min(10, Math.max(1, Math.round(Number(args.topK) || 5)))
      const indexResult = await runtime.index.query({
        question,
        scope,
        roomPath: runtime.getContext().roomPath,
        topK,
      })
      if (!indexResult.ok) return error('kb_index_unavailable', indexResult.message ?? '本地索引暂不可用')
      const envelope = buildRetrievalEnvelope(question, indexResult.hits)
      return { kind: 'references', text: envelope.text, references: envelope.references }
    } catch (cause) {
      return error('kb_ask_failed', cause instanceof Error ? cause.message : '知识库检索失败')
    }
  }
}

const READ_HANDLERS: ReadHandlerMap = {
  'workspace.getContext': async (_args, runtime) => {
    const ctx = runtime.getContext()
    const snapshot = runtime.snapshot()
    return result({
      activeTabId: ctx.activeTabId,
      roomPath: ctx.roomPath || snapshot.roomPath,
      selectedNodeIds: ctx.selectedNodeIds.slice(0, MAX_LIST_ITEMS),
      activeDocumentId: ctx.activeDocumentId,
      // 选中目标快照：只含 id / 标题 / 短片段，模型据此按 id 定位，不靠内容猜。
      // 旧 runtime（契约测试 mock）没有 selection 字段时保持原有输出形状。
      ...(ctx.selection ? {
        selection: {
          documentId: ctx.selection.documentId,
          documentTitle: ctx.selection.documentTitle,
          documentNodeId: ctx.selection.documentNodeId,
          nodeIds: ctx.selection.nodeIds.slice(0, MAX_LIST_ITEMS),
          nodeLabels: ctx.selection.nodeLabels.slice(0, MAX_LIST_ITEMS),
          blockIds: ctx.selection.blockIds.slice(0, MAX_LIST_ITEMS),
          blockExcerpt: ctx.selection.blockExcerpt,
          pinned: ctx.selection.pinned.slice(0, 8),
        },
      } : {}),
      viewport: ctx.viewport,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      documentCount: snapshot.documents.length,
    })
  },

  'document.read': async (args, runtime) => {
    try {
      const docId = asString(args, 'docId')
      const doc = await runtime.read.readDocument(docId)
      return result({ docId, ...doc })
    } catch (cause) {
      return error('document_read_failed', cause instanceof Error ? cause.message : '文档读取失败')
    }
  },

  'document.search': async (args, runtime) => {
    try {
      const query = asString(args, 'query')
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), MAX_LIST_ITEMS)
      const hits = await runtime.read.searchDocuments(query)
      return result({ query, count: hits.length, hits: hits.slice(0, limit) })
    } catch (cause) {
      return error('document_search_failed', cause instanceof Error ? cause.message : '文档检索失败')
    }
  },

  'graph.read': async (args, runtime) => {
    const snapshot = runtime.snapshot()
    const roomPath = asString(args, 'roomPath', false) || snapshot.roomPath
    const nodes = snapshot.nodes.slice(0, MAX_GRAPH_NODES).map((node) => ({
      id: node.id,
      label: node.label,
      parentId: node.parentId,
      position: node.position,
      containerType: node.containerType,
      linkedDocumentIds: node.linkedDocumentIds,
    }))
    const ids = new Set(nodes.map((node) => node.id))
    const edges = snapshot.edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .slice(0, MAX_GRAPH_NODES * 2)
    return result({
      roomPath,
      totalNodes: snapshot.nodes.length,
      totalEdges: snapshot.edges.length,
      truncated: snapshot.nodes.length > MAX_GRAPH_NODES,
      nodes,
      edges,
    })
  },

  'graph.relations': async (args, runtime) => {
    const docId = asString(args, 'docId', false)
    const nodeId = asString(args, 'nodeId', false)
    if (!docId && !nodeId) return error('tool_args_invalid', '需要 docId 或 nodeId')
    try {
      const [backlinks, relations] = docId
        ? await Promise.all([
          runtime.read.listDocumentBacklinks(docId),
          runtime.read.listDocumentRelations(docId),
        ])
        : [[] as Array<Record<string, unknown>>, {} as Record<string, unknown>]
      const snapshot = runtime.snapshot()
      const graphEdges = nodeId
        ? snapshot.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).slice(0, MAX_LIST_ITEMS)
        : []
      return result({ docId: docId || null, nodeId: nodeId || null, backlinks, relations, graphEdges })
    } catch (cause) {
      return error('relations_read_failed', cause instanceof Error ? cause.message : '关联读取失败')
    }
  },

  'kb.list': async (_args, runtime) => {
    try {
      const rooms = await runtime.read.listRooms()
      return result({ count: rooms.length, rooms: rooms.slice(0, MAX_LIST_ITEMS) })
    } catch (cause) {
      return error('kb_list_failed', cause instanceof Error ? cause.message : '房间枚举失败')
    }
  },
  // P3 / D：函数声明会提升，此处可直接注册；READ_TOOL_IDS 与目录 wired 只读集合同源。
  'kb.ask': createKbAskHandler(),
}

export const READ_TOOL_IDS: readonly string[] = Object.keys(READ_HANDLERS).sort()

/** S3：调度元工具。只由真实 tool_call 触发，绝不解析模型自由文本。 */
function createDelegateHandler(): ToolHandler {
  return async (args, runtime) => {
    const subAgentId = asString(args, 'subAgentId').slice(0, 128)
    const task = asString(args, 'task').slice(0, 4000)
    if (!subAgentId || !task.trim()) return error('tool_args_invalid', 'subAgentId 与 task 不能为空')
    if (!runtime.delegate) return error('delegate_unavailable', '当前会话不支持子智能体委托')
    try {
      const delegation = await runtime.delegate.run({ subAgentId, task })
      return { kind: 'delegate', text: delegateWireText(delegation), delegation }
    } catch (cause) {
      return error('delegate_failed', cause instanceof Error ? cause.message : '子智能体委托失败')
    }
  }
}

/** 回灌给主会话的是结构化摘要；委托卡片另走内存状态，不塞进 prompt 正文。 */
function delegateWireText(item: AgentDelegateResult): string {
  return JSON.stringify({
    ok: item.ok,
    subAgentId: item.agentId,
    agentName: item.agentName,
    task: item.task.slice(0, 200),
    elapsedMs: item.elapsedMs,
    rounds: item.rounds,
    toolIds: item.toolIds,
    summary: item.ok
      ? item.summary.slice(0, MAX_TOOL_RESULT_LENGTH)
      : `委托失败：${item.error ?? item.code ?? 'unknown'}`,
  })
}

export function getReadHandler(toolId: string): ToolHandler | null {
  if (toolId === 'agent.delegate') return createDelegateHandler()
  const handler = READ_HANDLERS[toolId]
  return handler ? (args, runtime) => handler(args, runtime) : null
}
