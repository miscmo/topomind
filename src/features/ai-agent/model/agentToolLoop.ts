/**
 * P2：tool calling 多轮编排控制器（模块级单例，不随组件挂载销毁）。
 *
 * 链路：startToolRun → 主进程 done(toolCalls) → 渲染层执行工具 → 结果回灌 → 下一轮。
 * 主进程只负责网络与协议解析，不执行工具、不持有会话状态；多轮上限在渲染层控制。
 *
 * 安全边界：
 *  - 每轮会话开始时固定一份 tools 快照（allowedIds），中途改配置不影响在途调用；
 *  - 写工具只产 AgentPatch op，经 normalize → dryRun → 人工勾选 → commitAgentPatch；
 *    本文件没有「自动应用」路径，auto 档不存在；
 *  - 工具明细只在内存 toolRounds，一次任务结束聚合记 1 条 ai.tool（C10 / C15）。
 */

import { startAiChat } from '@/core/ai-backend'
import { recordUser } from '@/core/observe'
import type {
  AiChatAgentPayload,
  AiDoneEvent,
  AiErrorCode,
  AiStartResult,
  AiToolCall,
  AiToolDefinition,
  AiWireMessage,
  AiWireToolCall,
} from '@/core/ai-types'
import type { WorkspaceApi } from '@/application/workspace/workspaceApi'
import { commitAgentPatch } from '../patch/commitAgentPatch'
import { dryRunAgentPatch } from '../patch/dryRunAgentPatch'
import { normalizeAgentPatch } from '../patch/normalizeAgentPatch'
import { AGENT_PATCH_SCHEMA, AGENT_PATCH_VERSION, type AgentDocumentState, type AgentPatchOp } from '../patch/agentPatchTypes'
import { WIRED_TOOL_IDS, executeToolCall, exportToolSchemas } from '../tools/toolRegistry'
import type { ToolRuntime } from '../tools/toolTypes'
import { abortAllDelegations, resetDelegationBudget } from './agentDelegation'
import { useAgentSessionStore, type ToolCallRecord } from './agentSessionStore'

/** 一次用户提问最多允许的连续工具轮次，防止模型无限自问自答。 */
export const MAX_TOOL_ROUNDS = 3

interface ActiveRun {
  baseTaskId: string
  round: number
  messages: AiWireMessage[]
  agent?: AiChatAgentPayload
  tools: AiToolDefinition[]
  allowedIds: ReadonlySet<string>
  runtime: ToolRuntime
  callCount: number
  toolIds: Set<string>
}

let activeRun: ActiveRun | null = null

function roundTaskId(base: string, round: number): string {
  return `${base}-r${round}`
}

function currentTaskId(): string | null {
  return activeRun ? roundTaskId(activeRun.baseTaskId, activeRun.round) : null
}

/** 一次任务只写一条聚合日志；工具明细不逐条落盘（C10 / C15）。 */
function finishRun(): void {
  const run = activeRun
  activeRun = null
  if (!run || run.callCount === 0) return
  void recordUser('ai.tool', {
    params: {
      taskId: run.baseTaskId,
      rounds: run.round + 1,
      callCount: run.callCount,
      toolIds: [...run.toolIds].sort(),
    },
    result: 'success',
    target: { type: 'app' },
  })
}

export interface StartToolRunOptions {
  baseTaskId: string
  messages: AiWireMessage[]
  agent?: AiChatAgentPayload
  toolIds: readonly string[]
  runtime: ToolRuntime
}

export async function startToolRun(options: StartToolRunOptions): Promise<AiStartResult> {
  const { baseTaskId, messages, agent, toolIds, runtime } = options
  const tools = exportToolSchemas(toolIds)
  // 白名单用工具 id（点号形式）比对；下发 schema 用 function name（下划线形式）。
  const allowedIds = new Set(toolIds.filter((id) => WIRED_TOOL_IDS.includes(id)))
  // S3：每次新任务重置委托预算，并清掉上一任务可能残留的在途子调用。
  abortAllDelegations()
  resetDelegationBudget()
  activeRun = {
    baseTaskId,
    round: 0,
    messages: [...messages],
    agent,
    tools,
    allowedIds,
    runtime,
    callCount: 0,
    toolIds: new Set(),
  }
  const taskId = roundTaskId(baseTaskId, 0)
  useAgentSessionStore.getState().startAssistant(taskId)
  try {
    const result = await startAiChat(taskId, messages, agent, tools)
    if (!result.ok) {
      finishRun()
      useAgentSessionStore.getState().fail(
        (result.code ?? 'bad_response') as AiErrorCode,
        result.message ?? '无法启动 AI 会话',
        taskId,
      )
    }
    return result
  } catch {
    finishRun()
    useAgentSessionStore.getState().fail('network', '无法连接 AI 网关，请稍后重试', taskId)
    return { ok: false, code: 'network', message: '无法连接 AI 网关，请稍后重试' }
  }
}

/** 用户主动停止 / 新建会话时清掉在途编排与所有子调用，避免迟到的 done 继续发起下一轮。 */
export function abortToolRun(): void {
  activeRun = null
  abortAllDelegations()
}

/**
 * 由 aiEventBridge 的 done 订阅调用。
 * @returns true 表示本轮由编排器接管（bridge 不要立即 finish）；false 表示按 P0 语义结束。
 */
export function handleAiDone(payload: AiDoneEvent): boolean {
  const run = activeRun
  if (!run || payload.taskId !== currentTaskId()) return false
  if (payload.cancelled) {
    finishRun()
    return false
  }
  const calls = payload.toolCalls
  if (!calls || calls.length === 0) {
    finishRun()
    return false
  }
  void runToolRound(run, calls)
  return true
}

function toWireToolCalls(calls: readonly AiToolCall[]): AiWireToolCall[] {
  return calls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments || '{}' },
  }))
}

async function runToolRound(run: ActiveRun, calls: AiToolCall[]): Promise<void> {
  const taskId = roundTaskId(run.baseTaskId, run.round)
  const store = useAgentSessionStore
  const results = await Promise.all(calls.map((call) => executeToolCall({
    call,
    runtime: run.runtime,
    allowedIds: run.allowedIds,
  })))

  // 迟到的取消 / 新会话：丢弃本轮结果，不再发起请求。
  if (activeRun !== run) return

  run.callCount += results.length
  for (const item of results) run.toolIds.add(item.toolId)
  const records: ToolCallRecord[] = results.map((item) => ({
    callId: item.callId,
    toolId: item.toolId,
    kind: item.outcome.kind === 'patch' ? 'patch'
      : item.outcome.kind === 'error' ? 'error'
        : item.outcome.kind === 'delegate' ? 'delegate' : 'result',
    summary: item.content.slice(0, 160),
  }))
  store.getState().recordToolRound({ round: run.round, calls: records })
  // S3：委托卡片与工具轮次同源，只记一次；失败委托同样留痕便于复盘。
  for (const item of results) {
    if (!item.delegation) continue
    store.getState().recordDelegation({
      ...item.delegation,
      id: `${taskId}-${item.callId}`,
      parentTaskId: taskId,
      createdAt: Date.now(),
    })
  }
  // P3：kb.ask 的 [ref:i] → docId 映射只在内存，供回答里的引用按钮跳转；
  // 外发文本里没有 docId / cardPath，模型伪造编号也打不开文档。
  const references = results.flatMap((item) => item.references ?? [])
  if (references.length > 0) store.getState().recordReferences(references)

  const ops: AgentPatchOp[] = []
  for (const item of results) {
    if (item.outcome.kind === 'patch') ops.push(...item.outcome.ops)
  }

  if (ops.length > 0) {
    // 出现写工具就停止自动循环：所有写操作必须停下来交给人工预览确认。
    const snapshot = run.runtime.snapshot()
    // 文档 / CardSpec 类 op 必须先异步抓一次目标文档的磁盘态：摘要用于提交并发校验，
    // dirty 用于挡住「用户正敲草稿、1500ms autosave 整篇覆盖 AI 写入」的风险。
    const documentIds = ops
      .map((op) => ('documentId' in op && typeof op.documentId === 'string' ? op.documentId : ''))
      .filter(Boolean)
    let documentStates: Record<string, AgentDocumentState> | undefined
    if (run.runtime.describeDocuments) {
      try {
        documentStates = await run.runtime.describeDocuments(documentIds)
      } catch {
        documentStates = undefined
      }
    }
    // 迟到的取消 / 新会话：预览阶段多了一次 await，必须再确认一次。
    if (activeRun !== run) return
    const raw = {
      schema: AGENT_PATCH_SCHEMA,
      version: AGENT_PATCH_VERSION,
      taskId,
      baseRevision: { roomRev: snapshot.roomRev },
      ops,
    }
    try {
      const patch = normalizeAgentPatch(raw)
      const plan = dryRunAgentPatch(patch, snapshot, { documentStates })
      store.getState().setPendingPatch(patch, plan)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '变更建议校验失败'
      store.getState().appendAssistantNote(`工具产出的变更未通过校验：${message}。未写入任何数据。`)
    }
    store.getState().finish(taskId, false)
    finishRun()
    return
  }

  if (run.round + 1 >= MAX_TOOL_ROUNDS) {
    store.getState().appendAssistantNote(`已达到工具调用轮次上限（${MAX_TOOL_ROUNDS} 轮），本次自动检索结束。`)
    store.getState().finish(taskId, false)
    finishRun()
    return
  }

  const assistantMessage: AiWireMessage = {
    role: 'assistant',
    content: '',
    tool_calls: toWireToolCalls(calls),
  }
  const toolMessages: AiWireMessage[] = results.map((item) => ({
    role: 'tool',
    tool_call_id: item.callId,
    content: item.content,
  }))
  run.messages = [...run.messages, assistantMessage, ...toolMessages]
  run.round += 1
  const nextTaskId = roundTaskId(run.baseTaskId, run.round)
  store.getState().continueAssistant(nextTaskId, run.round)
  try {
    const result = await startAiChat(nextTaskId, run.messages, run.agent, run.tools)
    if (!result.ok) {
      store.getState().fail(
        (result.code ?? 'bad_response') as AiErrorCode,
        result.message ?? '工具结果回灌失败',
        nextTaskId,
      )
      finishRun()
    }
  } catch {
    store.getState().fail('network', '工具结果回灌失败', nextTaskId)
    finishRun()
  }
}

/** 用户勾选后应用：全仓唯一写执行点，仍由 commitAgentPatch 做 digest 与事务校验。 */
export async function applyPendingPatch(api: WorkspaceApi): Promise<void> {
  const state = useAgentSessionStore.getState()
  const { pendingPatch, pendingPlan, selectedOpIds } = state
  if (!pendingPatch || !pendingPlan) return
  try {
    const result = await commitAgentPatch(pendingPatch, pendingPlan, selectedOpIds, api)
    const text = result.ok
      ? `已应用 ${result.appliedOpIds.length} 项变更，整次任务合并为 ${result.undoSteps} 步撤销。${result.warnings.join(' ')}`
      : `变更未应用：${result.issues.map((issue) => issue.message).join('；') || '提交失败'}。未写入任何数据。`
    useAgentSessionStore.getState().appendAssistantNote(text.trim())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '提交失败'
    useAgentSessionStore.getState().appendAssistantNote(`变更未应用：${message}。未写入任何数据。`)
  } finally {
    useAgentSessionStore.getState().clearPendingPatch()
  }
}

export function rejectPendingPatch(): void {
  useAgentSessionStore.getState().appendAssistantNote('已放弃本次变更建议，未写入任何数据。')
  useAgentSessionStore.getState().clearPendingPatch()
}
