/**
 * 多模型配置（P5）的渲染层内存镜像。
 *
 * 真源始终是主进程 `.topomind/ai/config.json`：这里只缓存 getAiConfig 的公开视图
 * （每个模型只有 hasKey，绝无明文 Key），不复制密钥、不写 localStorage 正文。
 * 设置页、Agent 表单、对话输入区的模型下拉共用这一份，避免三处各拉一次 IPC
 * 或改完配置后彼此显示不一致。
 *
 * 生效模型优先级：**对话界面临时选择 > Agent 绑定 > 全局默认**。
 * 解析结果只作为 modelId 随本轮请求快照下发，主进程再按 id 取连接参数与密钥。
 */
import { create } from 'zustand'
import { getAiConfig, saveAiConfig } from '@/core/ai-backend'
import type { AiModelProfile, AiModelProfileInput, AiPublicConfig } from '@/core/ai-types'
import { useAgentPreferencesStore } from './agentPreferencesStore'

/** 纯函数：非法 / 已删除 / 跨工作区的 id 一律回落到存在的模型，绝不返回死 id。 */
export function resolveModelId(
  profiles: readonly AiModelProfile[],
  defaultModelId: string,
  sessionModelId?: string | null,
  agentModelId?: string | null,
): string {
  const byId = new Set(profiles.map((profile) => profile.id))
  for (const candidate of [sessionModelId, agentModelId, defaultModelId]) {
    if (candidate && byId.has(candidate)) return candidate
  }
  return profiles[0]?.id ?? ''
}

interface AiModelState {
  profiles: AiModelProfile[]
  defaultModelId: string
  loaded: boolean
  loading: boolean
  error: string | null
  ensureLoaded: () => Promise<void>
  refresh: () => Promise<void>
  /** 工作区切换：丢掉旧工作区的模型 / 密钥状态，下次读取自动重拉。 */
  resetForWorkspace: () => void
  /** 提交整份列表；明文 Key 只在 IPC 通道里走一次，主进程加密后落 keyring。 */
  saveModels: (
    models: AiModelProfileInput[],
    defaultModelId: string,
    options?: {
      modelKeys?: Record<string, string>
      clearModelKeys?: string[]
      /** 默认模型的 Key 走共享 cipher，兼容旧版单 Key 链路。 */
      apiKey?: string
      clearKey?: boolean
    },
  ) => Promise<AiPublicConfig | null>
  /** 当前真正生效的模型（含会话临时选择）。 */
  resolveActive: (agentModelId?: string | null) => AiModelProfile | null
}

let inflight: Promise<void> | null = null

function applyConfig(set: (partial: Partial<AiModelState>) => void, config: AiPublicConfig) {
  set({
    profiles: config.models ?? [],
    defaultModelId: config.defaultModelId ?? config.models?.[0]?.id ?? '',
    loaded: true,
    loading: false,
    error: null,
  })
}

export const useAiModelStore = create<AiModelState>((set, get) => ({
  profiles: [],
  defaultModelId: '',
  loaded: false,
  loading: false,
  error: null,

  ensureLoaded: () => {
    if (get().loaded) return Promise.resolve()
    if (inflight) return inflight
    set({ loading: true })
    inflight = (async () => {
      try {
        applyConfig(set, await getAiConfig())
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : '无法读取模型配置' })
      } finally {
        inflight = null
      }
    })()
    return inflight
  },

  resetForWorkspace: () => {
    inflight = null
    set({ profiles: [], defaultModelId: '', loaded: false, loading: false, error: null })
  },

  refresh: () => {
    set({ loading: true })
    return (async () => {
      try {
        applyConfig(set, await getAiConfig())
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : '无法读取模型配置' })
      }
    })()
  },

  saveModels: async (models, defaultModelId, options) => {
    set({ loading: true })
    try {
      const next = await saveAiConfig({
        models,
        defaultModelId,
        ...(options?.apiKey?.trim() ? { apiKey: options.apiKey.trim() } : {}),
        ...(options?.clearKey ? { clearKey: true } : {}),
        ...(options?.modelKeys && Object.keys(options.modelKeys).length > 0
          ? { modelKeys: options.modelKeys }
          : {}),
        ...(options?.clearModelKeys && options.clearModelKeys.length > 0
          ? { clearModelKeys: options.clearModelKeys }
          : {}),
      })
      applyConfig(set, next)
      return next
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '保存模型配置失败' })
      return null
    }
  },

  resolveActive: (agentModelId) => {
    const state = get()
    const id = resolveModelId(
      state.profiles,
      state.defaultModelId,
      useAgentPreferencesStore.getState().sessionModelId,
      agentModelId,
    )
    return state.profiles.find((profile) => profile.id === id) ?? state.profiles[0] ?? null
  },
}))

/** 把公开配置转成可提交的输入形态（去掉主进程计算的 hasKey）。 */
export function toModelInput(profile: AiModelProfile): AiModelProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    baseURL: profile.baseURL,
    model: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    timeoutMs: profile.timeoutMs,
    contextBudget: profile.contextBudget,
  }
}

/** 新建模型的草稿：继承当前默认模型的服务地址与参数，只换 id / 名称 / 模型名。 */
export function newModelDraft(base?: AiModelProfile | null): AiModelProfileInput {
  return {
    id: `model.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
    name: '新模型',
    providerType: base?.providerType ?? 'openai-compatible',
    baseURL: base?.baseURL ?? 'https://api.openai.com/v1',
    model: base?.model ?? 'gpt-4o-mini',
    temperature: base?.temperature ?? 0.7,
    maxTokens: base?.maxTokens ?? 2048,
    timeoutMs: base?.timeoutMs ?? 60000,
    contextBudget: base?.contextBudget ?? 8000,
  }
}
