/**
 * S3 自动调度：子 Agent 独立调用运行器（渲染层模块级单例）。
 *
 * 设计依据：docs/design/native-ai-agent-design.md §11.2 / §15.9。
 * 只有 agent.delegate 的**真实 tool_call** 会进入这里；本文件不解析模型自由文本，
 * 也不 import AgentPanel / 任何 UI 组件。
 *
 * 硬约束：
 *  - 子调用沿用子 Agent 自己的 systemPrompt / model / reasoning，不继承主会话 system；
 *  - 子调用只开放「wired + read-only」工具子集，且强制剔除 agent.delegate，
 *    从根上杜绝递归委托；写工具不会出现在子调用里，因此不可能自动 commit；
 *  - 每轮子调用固定一份 tools 快照，中途配置变更不影响在途请求；
 *  - 白名单只允许 AgentConfigFile.allowedSubAgentIds 内、已启用、非 orchestrator 的 Agent；
 *  - 一次主任务最多 MAX_DELEGATIONS_PER_TASK 次委托，同时最多 MAX_PARALLEL_DELEGATIONS 个在途；
 *  - 主任务取消 / 新建会话时 abortAllDelegations() 级联取消全部在途子调用
 *    （主进程还有第二层 parentTaskId 级联，见 ai-service.js）。
 */
import { cancelAiChat, startAiChat, subscribeAiEvent } from '@/core/ai-backend'
import type {
  AiChatAgentPayload,
  AiDoneEvent,
  AiErrorEvent,
  AiToolCall,
  AiWireMessage,
  AiWireToolCall,
} from '@/core/ai-types'
import { SUB_AGENT_TOOL_IDS } from '../config/toolCatalog'
import type { AgentDefinition } from '../config/agentTypes'
import { buildPromptValues } from '../config/promptValues'
import { renderPrompt } from '../config/renderPrompt'
import { executeToolCall, exportToolSchemas } from '../tools/toolRegistry'
import type {
  AgentDelegatePort,
  AgentDelegateRequest,
  AgentDelegateResult,
  ToolRuntime,
} from '../tools/toolTypes'
import { useAgentDefinitionStore } from './agentDefinitionStore'
import { useAgentSessionStore } from './agentSessionStore'
import { useAiModelStore } from './aiModelStore'

export const MAX_PARALLEL_DELEGATIONS = 3
export const MAX_DELEGATIONS_PER_TASK = 4
export const MAX_SUB_TOOL_ROUNDS = 2
const SUB_TIMEOUT_MS = 45_000
const MAX_SUMMARY_LENGTH = 6000

/** 子调用只开放目录派生出的读工具集合；agent.delegate 已被显式剔除防递归。 */
const SUB_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(SUB_AGENT_TOOL_IDS)

const activeSubTasks = new Set<string>()
const waiters: Array<() => void> = []
let running = 0
let budget = 0
let sequence = 0

/** 每轮主任务开始时重置预算；由 agentToolLoop.startToolRun 调用。 */
export function resetDelegationBudget(): void {
  budget = 0
}

/** 主任务取消 / 新建会话：级联取消所有在途子调用，避免孤儿请求继续烧 token。 */
export function abortAllDelegations(): void {
  for (const taskId of activeSubTasks) cancelAiChat(taskId)
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL_DELEGATIONS) {
    await new Promise<void>((resolve) => { waiters.push(resolve) })
  }
  running += 1
  try {
    return await fn()
  } finally {
    running -= 1
    waiters.shift()?.()
  }
}

function readOnlySubToolIds(toolIds: readonly string[]): string[] {
  return [...new Set(toolIds.filter((id) => SUB_TOOL_ALLOWLIST.has(id)))].sort()
}

function toWireToolCalls(calls: readonly AiToolCall[]): AiWireToolCall[] {
  return calls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments || '{}' },
  }))
}

interface TaskOutcome {
  done?: AiDoneEvent
  error?: AiErrorEvent
  timedOut?: boolean
}

/**
 * 先同步注册监听再发起请求：本地 mock / 快响应端点可能在 invoke 返回前就推完 SSE，
 * 若注册晚于 startAiChat 会丢掉整段回答。返回的 cancel 用于启动失败时清理监听。
 */
function beginTask(taskId: string, onChunk: (delta: string) => void): {
  done: Promise<TaskOutcome>
  cancel: () => void
} {
  let settled = false
  // 超时句柄需要延迟赋值且在 finish 闭包中读取，用 const 状态对象承载，
  // 既避免 TDZ 也满足 prefer-const / refs 门禁。
  const state: { timer?: ReturnType<typeof setTimeout> } = {}
  let resolveDone: (value: TaskOutcome) => void = () => undefined
  const offs: Array<() => void> = []
  const done = new Promise<TaskOutcome>((resolve) => { resolveDone = resolve })
  const finish = (value: TaskOutcome) => {
    if (settled) return
    settled = true
    if (state.timer) clearTimeout(state.timer)
    for (const off of offs) off()
    resolveDone(value)
  }
  offs.push(subscribeAiEvent('chunk', (payload) => {
    if (payload.taskId === taskId) onChunk(payload.delta)
  }))
  offs.push(subscribeAiEvent('done', (payload) => {
    if (payload.taskId === taskId) finish({ done: payload })
  }))
  offs.push(subscribeAiEvent('error', (payload) => {
    if (payload.taskId === taskId) finish({ error: payload })
  }))
  state.timer = setTimeout(() => {
    cancelAiChat(taskId)
    finish({ timedOut: true })
  }, SUB_TIMEOUT_MS)
  return { done, cancel: () => finish({}) }
}

function resolveSubAgent(subAgentId: string): {
  id: string
  name: string
  systemPrompt: string
  promptVars: AgentDefinition['promptVars']
  model: AiChatAgentPayload['model']
  reasoning: AiChatAgentPayload['reasoning']
  toolIds: string[]
  /** P5：子 Agent 绑定的模型优先，否则跟随会话 / 全局默认。 */
  modelId: string
} | { code: string; error: string } {
  const config = useAgentDefinitionStore.getState().config
  if (!config) return { code: 'delegate_config_unavailable', error: '智能体配置尚未加载' }
  if (!config.allowedSubAgentIds.includes(subAgentId)) {
    return { code: 'delegate_not_allowed', error: `子智能体 ${subAgentId} 不在自动调度白名单内` }
  }
  const agent = config.agents.find((item) => item.id === subAgentId)
  if (!agent || !agent.enabled || agent.kind === 'orchestrator' || agent.id === config.orchestratorId) {
    return { code: 'delegate_target_invalid', error: `子智能体 ${subAgentId} 不可用或不是子 Agent` }
  }
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    promptVars: agent.promptVars,
    model: agent.model,
    reasoning: {
      mode: agent.model.reasoning.mode,
      protocol: agent.model.reasoning.protocol,
      effort: agent.model.reasoning.effort,
    },
    toolIds: agent.toolIds,
    modelId: useAiModelStore.getState().resolveActive(agent.modelId ?? null)?.id ?? '',
  }
}

function failure(
  request: AgentDelegateRequest,
  partial: Partial<AgentDelegateResult>,
  code: string,
  error: string,
  startedAt: number,
): AgentDelegateResult {
  return {
    ok: false,
    agentId: request.subAgentId,
    agentName: partial.agentName ?? request.subAgentId,
    systemPrompt: partial.systemPrompt ?? '',
    task: request.task,
    summary: `委托失败：${error}`,
    elapsedMs: Date.now() - startedAt,
    rounds: 0,
    toolIds: [],
    code,
    error,
  }
}

/**
 * 执行一次委托。返回结构化结果：既作为 role:'tool' 回灌主会话，也驱动委托卡片。
 * 主进程侧另有 parentTaskId 级联取消，这里只负责渲染层的预算 / 并发 / 快照。
 */
export async function runAgentDelegation(
  request: AgentDelegateRequest,
  runtime: ToolRuntime,
): Promise<AgentDelegateResult> {
  const startedAt = Date.now()
  const resolved = resolveSubAgent(request.subAgentId)
  if ('error' in resolved) {
    return failure(request, {}, resolved.code, resolved.error, startedAt)
  }
  if (budget >= MAX_DELEGATIONS_PER_TASK) {
    return failure(request, { agentName: resolved.name }, 'delegate_budget_exceeded',
      `单次任务最多允许 ${MAX_DELEGATIONS_PER_TASK} 次子智能体委托`, startedAt)
  }
  budget += 1

  return withSlot(async () => {
    const toolIds = readOnlySubToolIds(resolved.toolIds)
    const systemPrompt = renderPrompt(resolved.systemPrompt, buildPromptValues(toolIds), resolved.promptVars).prompt
    const chatAgent: AiChatAgentPayload = {
      agentId: resolved.id,
      systemPrompt,
      modelId: resolved.modelId || undefined,
      model: resolved.model,
      reasoning: resolved.reasoning,
    }
    // 会话开始即固定：后续配置变更不会改变本轮子调用的工具集合。
    const tools = exportToolSchemas(toolIds)
    const allowedIds = new Set(toolIds)
    // 子调用拿到的是「无 delegate 端口」的 runtime：即使模型伪造 agent.delegate，
    // 白名单与端口两道闸都过不去，递归委托没有代码路径。
    // P3：只读本地检索端口仍可注入，子 Agent 也能用 kb.ask 做知识库问答，
    // 但它拿不到任何写端口，且工具白名单由 SUB_AGENT_TOOL_IDS 固定。
    const subRuntime: ToolRuntime = {
      snapshot: runtime.snapshot,
      getContext: runtime.getContext,
      read: runtime.read,
      ...(runtime.describeDocuments ? { describeDocuments: runtime.describeDocuments } : {}),
      ...(runtime.index ? { index: runtime.index } : {}),
    }
    // 主进程用 parentTaskId 做第二层级联取消；这里取当前主轮次的 taskId。
    const parentTaskId = useAgentSessionStore.getState().taskId ?? ''
    const baseTaskId = `ai-sub-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`
    const ownedTaskIds: string[] = []
    let messages: AiWireMessage[] = [{ role: 'user', content: request.task }]
    let text = ''
    let rounds = 0
    let lastNote = ''

    try {
      for (let round = 0; round <= MAX_SUB_TOOL_ROUNDS; round += 1) {
        const taskId = round === 0 ? baseTaskId : `${baseTaskId}-r${round}`
        ownedTaskIds.push(taskId)
        activeSubTasks.add(taskId)
        let chunkText = ''
        const pending = beginTask(taskId, (delta) => { chunkText += delta })
        const start = await startAiChat(taskId, messages, chatAgent, tools, parentTaskId, resolved.modelId)
        if (!start.ok) {
          pending.cancel()
          return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
            start.code ?? 'delegate_start_failed', start.message ?? '子智能体会话启动失败', startedAt)
        }
        const outcome = await pending.done
        activeSubTasks.delete(taskId)
        if (outcome.timedOut) {
          return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
            'delegate_timeout', '子智能体响应超时', startedAt)
        }
        if (outcome.error) {
          return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
            `delegate_${outcome.error.code}`, outcome.error.message, startedAt)
        }
        text = chunkText
        const done = outcome.done
        if (!done) {
          return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
            'delegate_no_response', '子智能体未返回结果', startedAt)
        }
        if (done.cancelled) {
          return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
            'delegate_cancelled', '子智能体调用已取消', startedAt)
        }
        const calls = done.toolCalls ?? []
        if (calls.length === 0) break
        if (round >= MAX_SUB_TOOL_ROUNDS) {
          lastNote = `（已达到子调用工具轮次上限 ${MAX_SUB_TOOL_ROUNDS}，未继续回灌）`
          break
        }
        // 子调用只执行只读工具；executeToolCall 还会再过一次 allowedIds 快照闸。
        const results = await Promise.all(calls.map((call) => executeToolCall({
          call, runtime: subRuntime, allowedIds,
        })))
        messages = [
          ...messages,
          { role: 'assistant', content: '', tool_calls: toWireToolCalls(calls) },
          ...results.map((item) => ({
            role: 'tool' as const,
            tool_call_id: item.callId,
            content: item.content,
          })),
        ]
        rounds += 1
      }
      const summary = `${text.trim() || '（子智能体未返回正文）'}${lastNote}`
        .slice(0, MAX_SUMMARY_LENGTH)
      return {
        ok: true,
        agentId: resolved.id,
        agentName: resolved.name,
        systemPrompt,
        task: request.task,
        summary,
        elapsedMs: Date.now() - startedAt,
        rounds,
        toolIds,
      }
    } catch (cause) {
      return failure(request, { agentName: resolved.name, systemPrompt, toolIds },
        'delegate_failed', cause instanceof Error ? cause.message : '子智能体调用失败', startedAt)
    } finally {
      for (const taskId of ownedTaskIds) activeSubTasks.delete(taskId)
    }
  })
}

/** 注入 ToolRuntime 的端口：工具层只认这个纯接口，不认识本文件的实现。 */
export function createDelegatePort(runtime: ToolRuntime): AgentDelegatePort {
  return {
    run: (request) => runAgentDelegation(request, runtime),
  }
}
