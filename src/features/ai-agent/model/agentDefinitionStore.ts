/**
 * 智能体定义状态（S1-5 / S1-6）。
 *
 * 单一真源是主进程的 .topomind/ai/agents.json：本 store 只做内存镜像与
 * 编辑草稿的中转，不进 localStorage、不复制一份配置。所有写入都经
 * core/ai-backend 的两个 IPC，主进程 normalize 是最终校验闸。
 *
 * activeAgentId 是会话级选择，不落盘：刷新后回到 orchestrator。
 */
import { create } from 'zustand'
import { getAiAgentConfig, saveAiAgentConfig } from '@/core/ai-backend'
import { recordUser } from '@/core/observe'
import type { AgentConfigFile, AgentDefinition } from '../config/agentTypes'
import { createAgentFromTemplate } from '../config/agentTemplates'
import { isAssignableToolId } from '../config/toolCatalog'

interface AgentDefinitionState {
  config: AgentConfigFile | null
  activeAgentId: string | null
  loading: boolean
  error: string | null
  ensureLoaded: () => Promise<void>
  setActiveAgent: (id: string) => void
  save: (next: AgentConfigFile) => Promise<boolean>
  upsert: (agent: AgentDefinition) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  /** 成功返回新 Agent 的 id，失败返回 null。 */
  createFromTemplate: (templateId: string) => Promise<string | null>
}

let inflight: Promise<void> | null = null

function newAgentId(): string {
  return `agent.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeAgent(agent: AgentDefinition): AgentDefinition {
  return { ...agent, toolIds: [...new Set(agent.toolIds.filter(isAssignableToolId))] }
}

export const useAgentDefinitionStore = create<AgentDefinitionState>((set, get) => ({
  config: null,
  activeAgentId: null,
  loading: false,
  error: null,

  ensureLoaded: () => {
    if (get().config) return Promise.resolve()
    if (inflight) return inflight
    set({ loading: true })
    inflight = (async () => {
      try {
        const config = await getAiAgentConfig<AgentConfigFile>()
        const active = get().activeAgentId
        const exists = config.agents.some((agent) => agent.id === active && agent.enabled)
        set({
          config,
          activeAgentId: exists ? active : config.orchestratorId,
          error: null,
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '无法读取智能体配置' })
      } finally {
        set({ loading: false })
        inflight = null
      }
    })()
    return inflight
  },

  setActiveAgent: (id) => {
    const config = get().config
    const agent = config?.agents.find((item) => item.id === id && item.enabled)
    if (!agent || get().activeAgentId === id) return
    set({ activeAgentId: id })
    // 一条语义事件记录「切换了哪个 Agent」，不记 prompt 正文（§15.11）。
    void recordUser('ai.agent_select', { params: { agentId: id } }).catch(() => undefined)
  },

  save: (next) => {
    set({ loading: true, error: null })
    return (async () => {
      try {
        const saved = await saveAiAgentConfig<AgentConfigFile>(next)
        const active = get().activeAgentId
        const exists = saved.agents.some((agent) => agent.id === active && agent.enabled)
        set({
          config: saved,
          activeAgentId: exists ? active : saved.orchestratorId,
          loading: false,
          error: null,
        })
        return true
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : '保存智能体配置失败' })
        return false
      }
    })()
  },

  upsert: (agent) => {
    const config = get().config
    if (!config) return Promise.resolve(false)
    const clean = sanitizeAgent(agent)
    const found = config.agents.some((item) => item.id === clean.id)
    const agents = found
      ? config.agents.map((item) => (item.id === clean.id ? clean : item))
      : [...config.agents, clean]
    return get().save({ ...config, agents })
  },

  remove: (id) => {
    const config = get().config
    if (!config) return Promise.resolve(false)
    const target = config.agents.find((item) => item.id === id)
    if (!target || target.kind === 'orchestrator') return Promise.resolve(false)
    return get().save({
      ...config,
      agents: config.agents.filter((item) => item.id !== id),
      allowedSubAgentIds: config.allowedSubAgentIds.filter((item) => item !== id),
    })
  },

  createFromTemplate: (templateId) => {
    const created = createAgentFromTemplate(templateId, newAgentId())
    if (!created) return Promise.resolve(null)
    return get().upsert(created).then((ok) => (ok ? created.id : null))
  },
}))

/** 非 hook 场景（发送前组装请求）读取当前生效的 Agent。 */
export function getActiveAgent(): AgentDefinition | null {
  const { config, activeAgentId } = useAgentDefinitionStore.getState()
  if (!config) return null
  return config.agents.find((agent) => agent.id === activeAgentId)
    ?? config.agents.find((agent) => agent.id === config.orchestratorId)
    ?? config.agents[0]
    ?? null
}
