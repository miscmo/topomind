/**
 * P2：tool calling 多轮编排控制器（模块级单例，不随组件挂载销毁）。
 *
 * 链路：startToolRun → 主进程 done(toolCalls) → 渲染层执行工具 → 结果回灌 → 下一轮。
 * 主进程只负责网络与协议解析，不执行工具、不持有会话状态；多轮上限在渲染层控制。
 *
 * 安全边界：
 *  - 每轮会话开始时固定一份 tools 快照（allowedIds）与轮次上限快照，中途改配置不影响在途调用；
 *  - 写工具只产 AgentPatch op，经 normalize → dryRun → 人工勾选 → commitAgentPatch；
 *    本文件没有「自动应用」路径，auto 档不存在；
 *  - 工具明细只在内存 toolRounds，一次任务结束聚合记 1 条 ai.tool（C10 / C15）。
 *  - 轮次上限（用户可调，默认 20）与工具结果累计字符预算都只触发「收尾请求」：
 *    回灌最后一轮结果、不再下发 tools、让模型基于已有信息作答，绝不硬掐断任务。
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
import { normalizeMaxToolRounds, useAgentPreferencesStore } from './agentPreferencesStore'
import { useAgentSessionStore, type ToolCallRecord } from './agentSessionStore'

/**
 * 工具结果累计回灌的软预算（字符）。轮次放开后防止几十轮 × 长结果把上下文撑爆，
 * 触达时与轮次上限同样走「收尾请求」，只是提示文案不同。
 */
const MAX_TOOL_CONTEXT_CHARS = 120_000

interface ActiveRun {
  baseTaskId: string
  round: number
  messages: AiWireMessage[]
  agent?: AiChatAgentPayload
  /** P5：任务开始时快照的模型 id，多轮工具循环 / 收尾请求始终用同一份连接配置。 */
  modelId: string
  tools: AiToolDefinition[]
  allowedIds: ReadonlySet<string>
  runtime: ToolRuntime
  callCount: number
  toolIds: Set<string>
  /** 任务开始时快照的上限，避免在途改设置让已开始的循环忽长忽短。 */
  maxToolRounds: number
  /** 已回灌工具结果的累计字符数，作为上下文膨胀的第二道闸。 */
  contextChars: number
  /** 收尾请求中：不再接受任何 toolCalls，防止模型幻觉工具把循环再拉起来。 */
  finalizing: boolean
  /** 已对「只输出意图声明、却没有任何工具调用」做过一次自动续答。 */
  recoveredPreamble: boolean
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
  /** P5：本轮生效模型 id；留空则由主进程回退全局默认。 */
  modelId?: string
}

export async function startToolRun(options: StartToolRunOptions): Promise<AiStartResult> {
  const { baseTaskId, messages, agent, toolIds, runtime, modelId = '' } = options
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
    modelId,
    tools,
    allowedIds,
    runtime,
    callCount: 0,
    toolIds: new Set(),
    maxToolRounds: normalizeMaxToolRounds(useAgentPreferencesStore.getState().maxToolRounds),
    contextChars: 0,
    finalizing: false,
    recoveredPreamble: false,
  }
  const taskId = roundTaskId(baseTaskId, 0)
  useAgentSessionStore.getState().startAssistant(taskId)
  try {
    const result = await startAiChat(taskId, messages, agent, tools, undefined, modelId)
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
/**
 * 模型只吐一句「我先读取这篇文档…：」且没有任何 toolCalls 时，判定为空转声明。
 * 条件刻意收紧：短句 + 以冒号收尾或明确的「我先…」意图，避免误伤正常短答案。
 * 该函数同时被 AgentPanel 用来从历史消息里剔除这类无效回答，必须保持纯函数。
 */
export function looksLikeUnfinishedPreamble(text: string): boolean {
  const value = text.trim()
  if (!value || value.length > 160) return false
  if (/[：:]\s*$/.test(value)) return true
  return /^(我先|我先来|接下来|首先|让我|我会|需要|为了|下面)/.test(value)
    && /(读取|查看|检查|分析|定位|获取|确认|梳理)/.test(value)
}

/**
 * 空转兜底：本轮下发了工具却没收到任何 toolCalls，气泡里又只有一句计划声明时，
 * 自动发起一次收尾请求让模型把话说完。收尾轮不下发 tools：既避开不兼容的网关，
 * 也保证不会再拉起空转循环。每个任务最多兜底一次，绝不无限续轮。
 * @returns true 表示编排器已接管本轮，bridge 不要立即 finish。
 */
function tryRecoverPreamble(run: ActiveRun): boolean {
  if (run.tools.length === 0 || run.finalizing || run.recoveredPreamble) return false
  const store = useAgentSessionStore.getState()
  const last = store.messages[store.messages.length - 1]
  if (!last || last.role !== 'assistant') return false
  const text = typeof last.content === 'string' ? last.content : ''
  if (!looksLikeUnfinishedPreamble(text)) return false

  run.recoveredPreamble = true
  run.finalizing = true
  run.messages = [
    ...run.messages,
    { role: 'assistant', content: text },
    {
      role: 'user',
      content: '请接着上面的话，直接基于本轮消息里已提供的选中目标与当前内容给出完整答复：给出具体的修改建议或修改后的文本。不要只重复计划、不要再写「我先…」，也不要解释刚才为什么中断。',
    },
  ]
  run.round += 1
  const nextTaskId = roundTaskId(run.baseTaskId, run.round)
  // continueAssistant 复用同一条气泡，续答正文会直接接在那句声明后面。
  store.continueAssistant(nextTaskId, run.round)
  void (async () => {
    try {
      const result = await startAiChat(nextTaskId, run.messages, run.agent, undefined, undefined, run.modelId)
      if (!result.ok) {
        store.fail((result.code ?? 'bad_response') as AiErrorCode, result.message ?? '续答失败', nextTaskId)
        finishRun()
      }
    } catch {
      store.fail('network', '续答失败', nextTaskId)
      finishRun()
    }
  })()
  return true
}

export function handleAiDone(payload: AiDoneEvent): boolean {
  const run = activeRun
  if (!run || payload.taskId !== currentTaskId()) return false
  if (payload.cancelled) {
    finishRun()
    return false
  }
  // 收尾轮没下发 tools；即便模型仍幻觉出 toolCalls 也直接结束，不再进入编排。
  if (run.finalizing) {
    finishRun()
    return false
  }
  const calls = payload.toolCalls
  if (!calls || calls.length === 0) {
    if (tryRecoverPreamble(run)) return true
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
  run.contextChars += results.reduce((total, item) => total + item.content.length, 0)
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

  const reachedRoundLimit = run.round + 1 >= run.maxToolRounds
  const reachedContextBudget = run.contextChars >= MAX_TOOL_CONTEXT_CHARS
  const atLimit = reachedRoundLimit || reachedContextBudget

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
  const nextMessages: AiWireMessage[] = [...run.messages, assistantMessage, ...toolMessages]

  if (atLimit) {
    // 早期实现在这里直接 finish：最后一轮工具结果既没回灌，也没让模型作答，
    // 用户只看到一句「已达上限」，复杂任务因此表现为「失败」。现在改为收尾请求。
    const reason = reachedContextBudget
      ? `工具结果累计已达上下文预算（约 ${Math.round(MAX_TOOL_CONTEXT_CHARS / 1000)}k 字符）`
      : `已达到工具调用轮次上限（${run.maxToolRounds} 轮）`
    nextMessages.push({
      role: 'user',
      content: `${reason}。请基于上方已取得的工具结果直接给出最终答复，说明哪些部分尚未完成、还需要什么信息；不要再请求调用工具。`,
    })
    // 说明与最终答复共用同一条气泡（appendDelta 会接在后面），
    // 既不另起一条气泡，也不让原空占位残留「正在生成…」。
    store.getState().appendAssistantText(
      `${reason}。已让 AI 基于现有结果作答；如需继续，直接追问即可，也可在「AI 设置 → AI 助手」里调高轮次上限。\n\n`,
    )
    run.finalizing = true
  }

  run.messages = nextMessages
  run.round += 1
  const nextTaskId = roundTaskId(run.baseTaskId, run.round)
  store.getState().continueAssistant(nextTaskId, run.round)
  try {
    // 收尾轮不下发 tools：模型只能基于已有结果写正文，不可能再拉起工具循环。
    const result = await startAiChat(nextTaskId, run.messages, run.agent, atLimit ? undefined : run.tools, undefined, run.modelId)
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
