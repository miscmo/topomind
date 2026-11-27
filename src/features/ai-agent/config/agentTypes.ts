/**
 * AgentDefinition v1 / AgentConfigFile v1 —— S1-1 类型契约。
 *
 * 唯一设计来源：docs/design/native-ai-agent-design.md §15.8。
 * 本文件是**纯类型 + 编译期常量**：零 IO、零 React、零运行时副作用，
 * 主进程 electron/services/ai-agent-store.js 的 normalize 必须与字段一一对应。
 *
 * 三条不可协商的约束：
 *  1. 不含 baseURL / apiKeyRef —— 连接配置只有一个全局来源（决策 9）；
 *  2. 不用索引签名 —— 防止未知字段（尤其是密钥）被悄悄塞进来；
 *  3. 未知 version 抛错且不回写（对齐 normalizeCardSpecContent）。
 */

export const AGENT_DEFINITION_SCHEMA = 'topomind.agent-definition'
export const AGENT_DEFINITION_VERSION = 1
export const AGENT_CONFIG_SCHEMA = 'topomind.agent-config'
export const AGENT_CONFIG_VERSION = 1

export type AgentKind = 'orchestrator' | 'sub'
export type ReasoningMode = 'off' | 'on' | 'auto'
export type ReasoningEffort = 'low' | 'medium' | 'high'

export type ReasoningProtocol =
  | 'auto'
  | 'volcengine.thinking'
  | 'openai.reasoning_effort'
  | 'qwen.enable_thinking'
  | 'ollama.think'
  | 'openrouter.reasoning'
  | 'gemini.thinking_config'

export type PromptVarId =
  | 'nodeTitle'
  | 'roomPath'
  | 'selectedNodes'
  | 'activeTab'
  | 'documentTitle'
  | 'documentSummary'
  | 'linkedDocuments'
  | 'date'
  | 'tools'

/** 白名单变量表：renderPrompt 只认这里的 id，值一律由 buildContextEnvelope() 提供。 */
export const PROMPT_VAR_IDS: readonly PromptVarId[] = [
  'nodeTitle', 'roomPath', 'selectedNodes', 'activeTab',
  'documentTitle', 'documentSummary', 'linkedDocuments', 'date', 'tools',
]

export const PROMPT_VAR_LABELS: Readonly<Record<PromptVarId, string>> = {
  nodeTitle: '当前节点标题',
  roomPath: '房间路径',
  selectedNodes: '选中节点',
  activeTab: '当前标签页',
  documentTitle: '当前文档标题',
  documentSummary: '当前文档摘要',
  linkedDocuments: '关联文档',
  date: '日期',
  tools: '可用工具清单（仅元数据）',
}

export const REASONING_PROTOCOLS: readonly ReasoningProtocol[] = [
  'auto', 'volcengine.thinking', 'openai.reasoning_effort',
  'qwen.enable_thinking', 'ollama.think', 'openrouter.reasoning',
  'gemini.thinking_config',
]

export const REASONING_PROTOCOL_LABELS: Readonly<Record<ReasoningProtocol, string>> = {
  auto: '自动识别',
  'volcengine.thinking': '火山方舟 thinking',
  'openai.reasoning_effort': 'OpenAI reasoning_effort',
  'qwen.enable_thinking': 'Qwen / SiliconFlow enable_thinking',
  'ollama.think': 'Ollama think',
  'openrouter.reasoning': 'OpenRouter reasoning',
  'gemini.thinking_config': 'Gemini thinking_config',
}

export const REASONING_MODE_OPTIONS: ReadonlyArray<{ value: ReasoningMode; label: string; hint: string }> = [
  { value: 'auto', label: '自动', hint: '按供应商能力表匹配，识别不到就按普通模式发送' },
  { value: 'on', label: '开启', hint: '手动开启深度思考' },
  { value: 'off', label: '关闭', hint: '不发送任何推理字段' },
]

/** 字段级约束：S1-1 只声明，校验实现在 S1-4 的主进程 normalize。 */
export const AGENT_LIMITS = {
  systemPromptMax: 8000,
  nameMax: 60,
  descriptionMax: 200,
  maxAgents: 50,
  maxTags: 8,
  tagMax: 24,
  maxToolIds: 32,
} as const

export const AGENT_ERROR_CODES = [
  'agent_version_invalid',
  'agent_prompt_too_long',
  'agent_tool_unknown',
  'agent_orchestrator_invalid',
  'agent_duplicate_id',
  'agent_invalid_shape',
] as const

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number]

export const AGENT_ERROR_LABELS: Readonly<Record<AgentErrorCode, string>> = {
  agent_version_invalid: 'Agent 配置版本不兼容',
  agent_prompt_too_long: '系统提示词过长',
  agent_tool_unknown: '引用了未登记的工具',
  agent_orchestrator_invalid: '必须有且仅有一个总调度 Agent',
  agent_duplicate_id: 'Agent id 重复',
  agent_invalid_shape: 'Agent 定义不合法',
}

export interface AgentModelConfig {
  /** 留空 = 继承全局 config.json 的 model。 */
  model?: string
  temperature?: number
  topP?: number
  /** 非 OpenAI Chat Completions 标准字段，仅能力位允许时才发送。 */
  topK?: number
  maxTokens?: number
  presencePenalty?: number
  reasoning: {
    mode: ReasoningMode
    protocol: ReasoningProtocol
    effort?: ReasoningEffort
  }
}

export interface AgentDefinition {
  schema: typeof AGENT_DEFINITION_SCHEMA
  version: typeof AGENT_DEFINITION_VERSION
  id: string
  name: string
  description: string
  kind: AgentKind
  /** 可含 {{var}}，变量必须在 promptVars 中声明。 */
  systemPrompt: string
  promptVars: PromptVarId[]
  model: AgentModelConfig
  /** P5：绑定到模型列表里的具体配置；留空 = 跟随全局默认，对话界面仍可临时覆盖。 */
  modelId?: string
  /** 只能引用 toolCatalog 中的 id，且不得包含 never 组。 */
  toolIds: string[]
  enabled: boolean
  origin: 'template' | 'user'
  templateId?: string
  tags?: string[]
}

export interface AgentConfigFile {
  schema: typeof AGENT_CONFIG_SCHEMA
  version: typeof AGENT_CONFIG_VERSION
  agents: AgentDefinition[]
  /** 有且仅有一个 kind:'orchestrator' 的 Agent。 */
  orchestratorId: string
  /** S3 调度白名单；S1 / S2 只做展示。 */
  allowedSubAgentIds: string[]
}

export const DEFAULT_REASONING: Readonly<AgentModelConfig['reasoning']> = {
  mode: 'auto',
  protocol: 'auto',
}

export const DEFAULT_AGENT_MODEL: Readonly<AgentModelConfig> = {
  reasoning: DEFAULT_REASONING,
}

export function isPromptVarId(value: unknown): value is PromptVarId {
  return typeof value === 'string' && (PROMPT_VAR_IDS as readonly string[]).includes(value)
}

export function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === 'off' || value === 'on' || value === 'auto'
}

export function isReasoningProtocol(value: unknown): value is ReasoningProtocol {
  return typeof value === 'string' && (REASONING_PROTOCOLS as readonly string[]).includes(value)
}
