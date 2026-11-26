/**
 * AI 网关的渲染侧 IPC 封装（P0）。
 *
 * 与 fs-backend.ts 同构：业务代码只通过这里访问 window.electronAPI，
 * 不直接碰 IPC、更不能在渲染进程里 fetch 外部模型端点（生产 CSP 禁止）。
 * 流式结果由主进程 webContents.send 推送，用订阅而非 invoke 接收。
 */
import type { ElectronAPI } from '../types/electron-api'
import type {
  AiChatAgentPayload,
  AiChunkEvent,
  AiConfigPatch,
  AiDoneEvent,
  AiErrorEvent,
  AiIndexQuery,
  AiIndexResult,
  AiPublicConfig,
  AiSessionDeleteResult,
  AiSessionListResult,
  AiSessionRecord,
  AiSessionSummary,
  AiStartResult,
  AiTestResult,
  AiToolDefinition,
  AiWireMessage,
} from './ai-types'

const getApi = (): ElectronAPI | null => {
  const w = window as Window
  return (w.electronAPI ?? null) as ElectronAPI | null
}

function requireApi(): ElectronAPI {
  const api = getApi()
  if (!api || typeof api.invoke !== 'function') {
    throw new Error('AI 网关不可用：需要 Electron 桌面环境')
  }
  return api
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return requireApi().invoke(channel, ...args) as Promise<T>
}

export function getAiConfig(): Promise<AiPublicConfig> {
  return invoke<AiPublicConfig>('ai:config:get')
}

export function saveAiConfig(patch: AiConfigPatch): Promise<AiPublicConfig> {
  return invoke<AiPublicConfig>('ai:config:save', patch)
}

export function testAiConnection(): Promise<AiTestResult> {
  return invoke<AiTestResult>('ai:chat:test')
}

/**
 * S1：智能体定义读写，独立 .topomind/ai/agents.json。
 * core 层不能反向依赖 features，因此契约类型由调用方以泛型注入
 * （features/ai-agent 会传 AgentConfigFile）。
 */
export function getAiAgentConfig<T = unknown>(): Promise<T> {
  return invoke<T>('ai:agents:get')
}

export function saveAiAgentConfig<T = unknown>(config: T): Promise<T> {
  return invoke<T>('ai:agents:set', config)
}

/**
 * P4-S：历史会话持久化，落 <workDir>/.topomind/ai/sessions.json。
 * 与 agents.json 同属主进程文件，渲染层不读盘、不碰 localStorage 正文；
 * 会话正文不经过任何日志通道（§15.4 / C10 / C15）。
 */
export function listAiSessions(): Promise<AiSessionListResult> {
  return invoke<AiSessionListResult>('ai:sessions:list')
}

export function getAiSession(id: string): Promise<AiSessionRecord | null> {
  return invoke<AiSessionRecord | null>('ai:sessions:get', id)
}

export function upsertAiSession(record: AiSessionRecord): Promise<AiSessionSummary> {
  return invoke<AiSessionSummary>('ai:sessions:upsert', record)
}

export function deleteAiSession(id: string): Promise<AiSessionDeleteResult> {
  return invoke<AiSessionDeleteResult>('ai:sessions:delete', id)
}

/** P2：tools 为该 Agent 允许的工具子集快照，一轮会话内固定，不随配置变更。 */
export function startAiChat(
  taskId: string,
  messages: AiWireMessage[],
  agent?: AiChatAgentPayload,
  tools?: readonly AiToolDefinition[],
  /** S3：子调用登记父任务，主进程 cancel 时级联 abort 所有后代。 */
  parentTaskId?: string,
): Promise<AiStartResult> {
  return invoke<AiStartResult>('ai:chat:start', {
    taskId,
    messages,
    ...(agent ? { agent } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
  })
}

/**
 * P3 / D：本地简版 RAG 检索。主进程惰性建 / 增量重建索引，只读写
 * `.topomind/ai-index/`；渲染层不直接读盘、不直连外部检索服务。
 */
export function queryAiIndex(request: AiIndexQuery): Promise<AiIndexResult> {
  return invoke<AiIndexResult>('ai:index:query', request)
}

export function cancelAiChat(taskId: string): void {
  const api = getApi()
  if (api && typeof api.send === 'function') api.send('ai:chat:cancel', taskId)
}

type AiEventName = 'chunk' | 'done' | 'error'

/**
 * 订阅主进程推送的流式事件，返回取消订阅函数。
 * 组件卸载时必须调用，否则 preload 的 WeakMap 会一直持有回调。
 */
export function subscribeAiEvent<T extends AiEventName>(
  event: T,
  handler: (payload: T extends 'chunk' ? AiChunkEvent : T extends 'done' ? AiDoneEvent : AiErrorEvent) => void,
): () => void {
  const api = getApi()
  if (!api || typeof api.on !== 'function' || typeof api.off !== 'function') return () => undefined
  const channel = `ai:chat:${event}`
  const listener = ((...args: unknown[]) => {
    const payload = args[0]
    if (payload && typeof payload === 'object') {
      handler(payload as never)
    }
  }) as (...args: unknown[]) => void
  api.on(channel, listener)
  return () => api.off(channel, listener)
}
