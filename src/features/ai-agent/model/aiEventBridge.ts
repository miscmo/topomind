/**
 * AI 流式事件的全局单例桥（P0 修复）。
 *
 * 背景：早期把订阅写在 AgentPanel 的 useEffect 里，StrictMode 双挂载、左栏
 * 反复切换、开发态 HMR 都会让同一个 chunk 被多个 listener 各自 append 一次，
 * 表现为回答里每个片段重复 2~4 遍。流式事件属于「应用级一条管道」，不该
 * 跟着组件生命周期反复注册。
 *
 * 这里在模块加载时注册一次，并用 globalThis 存 disposer；HMR 导致 store 模块
 * 被替换时先注销旧管道再重建，避免开发态出现「旧 listener 写旧 store」的断链。
 */
import { subscribeAiEvent } from '@/core/ai-backend'
import { handleAiDone } from './agentToolLoop'
import { useAgentSessionStore } from './agentSessionStore'

const BRIDGE_KEY = '__topomind_ai_event_bridge_v1__'

interface BridgeRecord {
  store: unknown
  dispose: () => void
}

type BridgeScope = typeof globalThis & { __topomind_ai_event_bridge_v1__?: BridgeRecord }

export function ensureAiEventBridge(): void {
  const scope = globalThis as BridgeScope
  const previous = scope[BRIDGE_KEY]
  if (previous && previous.store === useAgentSessionStore) return
  previous?.dispose()

  const offChunk = subscribeAiEvent('chunk', (payload) => {
    useAgentSessionStore.getState().appendDelta(payload.taskId, payload.seq, payload.delta)
  })
  const offDone = subscribeAiEvent('done', (payload) => {
    // P2：done 携带 toolCalls 时由编排器接管，保持 streaming 状态直到工具轮次结束。
    if (handleAiDone(payload)) return
    useAgentSessionStore.getState().finish(payload.taskId, payload.cancelled)
  })
  const offError = subscribeAiEvent('error', (payload) => {
    useAgentSessionStore.getState().fail(payload.code, payload.message, payload.taskId)
  })

  scope[BRIDGE_KEY] = {
    store: useAgentSessionStore,
    dispose: () => {
      offChunk()
      offDone()
      offError()
    },
  }
}
