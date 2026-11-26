/**
 * P2：工具注册表（编译期静态，运行时不可增删）。
 *
 * 与 §15.3 的约定一致：toolCatalog 只做「可分配白名单」，本注册表才是运行时
 * tool calling 的唯一真源；exportToolSchemas() 的产物才允许进入主进程请求体。
 *
 * 安全边界（§2.2 / §6.2）：
 *  - 注册 17 个已实现工具（含 S3 调度元工具 agent.delegate 与 P3 的 kb.ask）；
 *    3 个破坏性工具永不注册；
 *  - 每个 call 先比对「本轮会话固定的 tools 快照」白名单，再解析 arguments；
 *  - 写工具只返回 AgentPatch op，不 import commitAgentPatch，auto 档没有代码路径；
 *  - 不解析自由文本指令、不执行任意代码、不读磁盘、不联网。
 */

import type { AiToolCall, AiToolDefinition } from '@/core/ai-types'
import { isAssignableToolId, NEVER_TOOL_IDS } from '../config/toolCatalog'
import { createWriteHandler, getReadHandler, isWriteToolId, MAX_TOOL_RESULT_LENGTH } from './toolHandlers'
import { TOOL_SCHEMA_IDS, TOOL_SCHEMAS } from './toolSchemas'
import type { RegisteredTool, ToolExecutionResult, ToolOutcome, ToolRuntime } from './toolTypes'

/** OpenAI function name 不允许点号（部分供应商更严格），统一换成下划线。 */
export function toolIdToFunctionName(toolId: string): string {
  return toolId.replace(/\./g, '_')
}

const NAME_TO_ID = new Map<string, string>()

export function functionNameToToolId(name: string): string | null {
  return NAME_TO_ID.get(name) ?? null
}

function buildRegistry(): readonly RegisteredTool[] {
  const tools: RegisteredTool[] = []
  for (const id of TOOL_SCHEMA_IDS) {
    const entry = TOOL_SCHEMAS[id]
    if (!entry || !isAssignableToolId(id) || NEVER_TOOL_IDS.includes(id)) continue
    const write = isWriteToolId(id)
    const handler = write ? createWriteHandler(id) : getReadHandler(id)
    if (!handler) throw new Error(`工具 ${id} 缺少执行体`)
    const functionName = toolIdToFunctionName(id)
    NAME_TO_ID.set(functionName, id)
    tools.push({
      id,
      kind: write ? 'write' : 'read',
      type: 'function',
      function: {
        name: functionName,
        description: entry.description,
        parameters: entry.parameters,
      },
      handler,
    })
  }
  return tools
}

export const REGISTERED_TOOLS: readonly RegisteredTool[] = buildRegistry()

export const WIRED_TOOL_IDS: readonly string[] = REGISTERED_TOOLS.map((tool) => tool.id).sort()

/** 只有目录里可分配、且本注册表已实现的工具会被下发。 */
export function exportToolSchemas(allowedIds: readonly string[]): AiToolDefinition[] {
  const allowed = new Set(allowedIds.filter(isAssignableToolId))
  return REGISTERED_TOOLS
    .filter((tool) => allowed.has(tool.id))
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }))
}

/** arguments 必须是 JSON 对象字符串，长度与深度做基本收敛。 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length > MAX_TOOL_RESULT_LENGTH * 2) {
    throw new Error('工具参数过长')
  }
  const parsed: unknown = JSON.parse(raw || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function toWireContent(outcome: ToolOutcome): string {
  const text = outcome.kind === 'error'
    ? JSON.stringify({ error: { code: outcome.code, message: outcome.text } })
    : outcome.text
  return text.length > MAX_TOOL_RESULT_LENGTH ? `${text.slice(0, MAX_TOOL_RESULT_LENGTH)}…` : text
}

export interface ExecuteToolOptions {
  call: AiToolCall
  runtime: ToolRuntime
  /** 本轮会话开始时固定的工具白名单，中途配置变更不影响在途调用。 */
  allowedIds: ReadonlySet<string>
}

export async function executeToolCall({ call, runtime, allowedIds }: ExecuteToolOptions): Promise<ToolExecutionResult> {
  const toolId = functionNameToToolId(call.name)
  if (!toolId || !allowedIds.has(toolId)) {
    const outcome: ToolOutcome = {
      kind: 'error',
      code: 'tool_not_allowed',
      text: `工具 ${call.name} 不在当前智能体允许范围内，已拒绝执行。`,
    }
    return { callId: call.id, toolId: toolId ?? call.name, outcome, content: toWireContent(outcome) }
  }
  const tool = REGISTERED_TOOLS.find((item) => item.id === toolId)
  if (!tool) {
    const outcome: ToolOutcome = { kind: 'error', code: 'tool_not_wired', text: '工具尚未接入' }
    return { callId: call.id, toolId, outcome, content: toWireContent(outcome) }
  }
  let args: Record<string, unknown>
  try {
    args = parseToolArguments(call.arguments)
  } catch (cause) {
    const outcome: ToolOutcome = {
      kind: 'error',
      code: 'tool_args_invalid',
      text: cause instanceof Error ? cause.message : '工具参数解析失败',
    }
    return { callId: call.id, toolId, outcome, content: toWireContent(outcome) }
  }
  try {
    const outcome = await tool.handler(args, runtime)
    return {
      callId: call.id,
      toolId,
      outcome,
      content: toWireContent(outcome),
      ...(outcome.kind === 'delegate' ? { delegation: outcome.delegation } : {}),
      ...(outcome.kind === 'references' ? { references: outcome.references } : {}),
    }
  } catch (cause) {
    const outcome: ToolOutcome = {
      kind: 'error',
      code: 'tool_execution_failed',
      text: cause instanceof Error ? cause.message : '工具执行失败',
    }
    return { callId: call.id, toolId, outcome, content: toWireContent(outcome) }
  }
}
