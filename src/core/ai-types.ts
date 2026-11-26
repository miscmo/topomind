/**
 * AI 网关的渲染侧共享契约（P0）。
 *
 * 放在 core 层而不是 features：core/ai-backend.ts 与 features/ai-agent 都要用，
 * 不能让 core 反向依赖 features。主进程侧的字段名必须与此文件一一对应，
 * 变更时同步 electron/services/ai-key-store.js 与 ai-service.js。
 */

export type AiProviderType = 'openai-compatible' | 'ollama' | 'hosted'

/** 从主进程返回的配置：绝不包含明文 API Key，只有 hasKey。 */
export interface AiPublicConfig {
  providerType: AiProviderType
  baseURL: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  contextBudget: number
  hasKey: boolean
}

/** 保存配置时的可选附加字段：apiKey 为空表示「不修改现有密钥」。 */
export interface AiConfigPatch extends Partial<Omit<AiPublicConfig, 'hasKey'>> {
  apiKey?: string
  clearKey?: boolean
}

export type AiErrorCode =
  | 'no_key'
  | 'invalid_config'
  | 'unsupported_provider'
  | 'busy'
  | 'network'
  | 'timeout'
  | 'rate_limit'
  | 'bad_response'
  | 'cancelled'
  | 'key_storage_unavailable'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 流式输出中的助手消息标记，结束后清空。 */
  streaming?: boolean
  /** S2：本轮使用的 Agent 与深度思考三态，便于事后复盘模型行为。 */
  agentId?: string
  reasoningMode?: 'off' | 'on' | 'auto'
}

/**
 * S2：随会话下发的 Agent 参数（core 层不依赖 features，故独立定义）。
 * systemPrompt 是渲染层 renderPrompt() 渲染后的最终字符串，主进程只做限长
 * 与单 system 构造，不解析模板语法；这里绝不含 baseURL / apiKey（决策 9）。
 */
export interface AiChatAgentPayload {
  agentId: string
  systemPrompt: string
  model?: {
    model?: string
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    presencePenalty?: number
  }
  /** 会话覆盖优先于 Agent 定义；渲染层已完成合并。 */
  reasoning?: {
    mode: 'off' | 'on' | 'auto'
    protocol?: string
    effort?: 'low' | 'medium' | 'high'
  }
}

/** P2：下发给模型的 function tool 定义（主进程会再做一次白名单校验）。 */
export interface AiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** P2：模型返回的 tool_call；arguments 是 JSON 字符串，由渲染层解析并校验。 */
export interface AiToolCall {
  id: string
  name: string
  arguments: string
}

/** P2：assistant 回灌用的 tool_call 结构（OpenAI 兼容格式）。 */
export interface AiWireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** P2：多轮消息；tool 轮次必须带 tool_call_id，assistant 轮次可只有 tool_calls。 */
export interface AiWireMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: AiWireToolCall[]
}

export interface AiChunkEvent {
  taskId: string
  delta: string
  /** 主进程单调递增序号；渲染层据此丢弃重复/乱序推送。 */
  seq?: number
}

export interface AiDoneEvent {
  taskId: string
  cancelled: boolean
  seq?: number
  /** P2：本轮模型请求的工具调用；非空时渲染层执行工具并发起下一轮，而不是结束会话。 */
  toolCalls?: AiToolCall[]
}

export interface AiErrorEvent {
  taskId: string
  code: AiErrorCode
  message: string
}

export interface AiTestResult {
  ok: boolean
  code?: AiErrorCode
  message?: string
  model?: string
}

export interface AiStartResult {
  ok: boolean
  taskId?: string
  code?: AiErrorCode
  message?: string
}

/**
 * P3 / D：简版 RAG 的本地检索契约。
 * 主进程只做本地磁盘倒排检索，不联网；hits 里的 cardPath 是给渲染层做引用跳转的，
 * 由 buildContextEnvelope() 裁剪后才允许把正文片段外发给模型（§8 唯一外发组装点）。
 */
export type AiIndexScope = 'all' | 'kb' | 'room'

export interface AiIndexQuery {
  question: string
  scope?: AiIndexScope
  /** 当前房间路径（相对 kbs），用于 room / kb 范围过滤。 */
  roomPath?: string
  topK?: number
}

export interface AiIndexHit {
  ref: number
  docId: string
  cardPath: string
  title: string
  breadcrumb: string
  /** 片段相对抽取全文的字符范围，供引用定位。 */
  charRange: [number, number]
  text: string
  score: number
}

export interface AiIndexMeta {
  created: boolean
  rebuiltSources: number
  removedSources: number
  totalSources: number
  totalChunks: number
  scope: AiIndexScope
  tookMs: number
  noHit: boolean
}

export interface AiIndexResult {
  ok: boolean
  code?: 'invalid_request' | 'index_unavailable'
  message?: string
  hits: AiIndexHit[]
  meta: AiIndexMeta
}

/** 只存在渲染层内存的 [ref:i] → docId 映射，不随任何请求外发。 */
export interface AiReference {
  ref: number
  docId: string
  cardPath: string
  title: string
  breadcrumb: string
  charRange: [number, number]
}

export const AI_ERROR_LABELS: Record<AiErrorCode, string> = {
  no_key: '尚未配置 API Key',
  invalid_config: '配置不合法',
  unsupported_provider: '暂不支持该供应商',
  busy: '对话过多',
  network: '网络异常',
  timeout: '响应超时',
  rate_limit: '服务限流',
  bad_response: '响应解析失败',
  cancelled: '已停止',
  key_storage_unavailable: '系统不支持安全存储',
}
