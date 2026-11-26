/**
 * AI 工具层类型契约（P2 / C）。
 *
 * 设计依据：docs/design/native-ai-agent-design.md §6.1 / §6.2 / §15.3。
 * 本文件是纯类型，禁止 import React / window / electronAPI / 任何 IO，
 * 必须能被 scripts/verify-ai-agent-contracts.mts 用 esbuild 打包后真跑。
 *
 * 关键边界：
 *  - 模型永远不直接写业务数据；写工具只把结构化参数映射成 AgentPatch op，
 *    由 normalize → dryRun → 人工勾选 → commitAgentPatch 三段链路落地；
 *  - 读工具只走渲染层注入的既有只读端口，不新开 IPC / 磁盘读取路径；
 *  - auto 档在本层没有代码路径，registry 不 import commitAgentPatch。
 */

import type { AiIndexQuery, AiIndexResult, AiReference, AiToolDefinition, AiToolCall } from '@/core/ai-types'
import type { AgentDocumentState, AgentPatchOp, WorkspaceSnapshot } from '../patch/agentPatchTypes'

export type ToolKind = 'read' | 'write'

/** 工具执行期可用的只读上下文；全部由渲染层注入，工具本身不碰全局单例。 */
export interface ToolWorkspaceContext {
  activeTabId: string
  roomPath: string
  workDir: string
  selectedNodeIds: string[]
  activeDocumentId: string | null
  viewport?: { x: number; y: number; zoom: number }
}

/** 只读业务查询端口：由 useAgentToolRuntime 绑定既有 storage / store 方法。 */
export interface ToolReadPort {
  searchDocuments(query: string): Promise<Array<Record<string, unknown>>>
  listRooms(): Promise<Array<Record<string, unknown>>>
  readDocument(docId: string): Promise<Record<string, unknown>>
  listDocumentRelations(docId: string): Promise<Record<string, unknown>>
  listDocumentBacklinks(docId: string): Promise<Array<Record<string, unknown>>>
}

/**
 * P3 / D：本地简版 RAG 检索端口。执行体由渲染层注入 core/ai-backend 的
 * `ai:index:query`；工具层只认这个纯接口，不碰 IPC / window / 磁盘。
 */
export interface AiIndexPort {
  query(request: AiIndexQuery): Promise<AiIndexResult>
}

/** S3：调度元工具的端口。执行体在 model 层，工具层只持有纯数据契约。 */
export interface AgentDelegateRequest {
  subAgentId: string
  task: string
}

/** 委托卡片与 role:'tool' 回灌共同消费的结构化结果（不含任何业务数据）。 */
export interface AgentDelegateResult {
  ok: boolean
  agentId: string
  agentName: string
  /** 子 Agent 实际生效的最终 system prompt，供委托卡片复盘。 */
  systemPrompt: string
  task: string
  /** 回灌给主会话的结果摘要。 */
  summary: string
  elapsedMs: number
  /** 子调用实际走过的工具轮次数（0 表示纯文本回答）。 */
  rounds: number
  /** 子调用本轮固定的只读工具快照 id。 */
  toolIds: string[]
  code?: string
  error?: string
}

export interface AgentDelegatePort {
  run(request: AgentDelegateRequest): Promise<AgentDelegateResult>
}

export interface ToolRuntime {
  /** 全量图快照，明确不读 lod.visibleNodes。 */
  snapshot(): WorkspaceSnapshot
  getContext(): ToolWorkspaceContext
  read: ToolReadPort
  /** 文档 / CardSpec 写工具在预览前异步抓取目标文档磁盘态 + 脏草稿态。 */
  describeDocuments?(docIds: readonly string[]): Promise<Record<string, AgentDocumentState>>
  /** S3：只有注入该端口时 agent.delegate 才可用；子调用不会再次注入。 */
  delegate?: AgentDelegatePort
  /** P3：只读本地检索端口；子调用同样可注入（kb.ask 是只读工具）。 */
  index?: AiIndexPort
}

export type ToolOutcome =
  | { kind: 'result'; text: string }
  | { kind: 'patch'; text: string; ops: AgentPatchOp[] }
  | { kind: 'delegate'; text: string; delegation: AgentDelegateResult }
  /** P3：kb.ask 的检索片段；references 只进渲染层内存，不外发 docId / 磁盘路径。 */
  | { kind: 'references'; text: string; references: AiReference[] }
  | { kind: 'error'; text: string; code: string }

export interface ToolHandler {
  (args: Record<string, unknown>, runtime: ToolRuntime): Promise<ToolOutcome>
}

export interface RegisteredTool extends AiToolDefinition {
  id: string
  kind: ToolKind
  handler: ToolHandler
}

export interface ToolExecutionResult {
  callId: string
  toolId: string
  outcome: ToolOutcome
  /** 回灌给模型的 role:'tool' content（统一限长、脱敏后）。 */
  content: string
  /** S3：agent.delegate 的结构化结果，供委托卡片渲染（不进 wire content 之外的地方）。 */
  delegation?: AgentDelegateResult
  /** P3：kb.ask 的 [ref:i] → docId 映射，供回答里的引用按钮跳转。 */
  references?: AiReference[]
}

export type { AiToolCall }
