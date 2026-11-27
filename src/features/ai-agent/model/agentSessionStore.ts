/**
 * AI Agent 会话状态（P0 起，P2 扩展工具轮次与 Patch 预览）。
 *
 * 设计取舍（P4-S 修订）：本 store 仍是「当前活动会话」的运行时状态，
 * 不直接落盘、不进 localStorage（项目已有 base64 内容撑爆 localStorage 的
 * 历史教训）。历史会话由 agentSessionListStore 经 IPC 写主进程 sessions.json；
 * 正文只在磁盘，工具调用明细 / 变更预览 / 委托卡片 / 引用映射仍只保留在内存，
 * 不逐条写日志（C10 / C15）。切换会话时由 hydrate() 换入新快照。
 *
 * P2 新增：
 *  - toolRounds：每轮工具调用的只读摘要，供 UI 展示「模型到底调了什么」；
 *  - pendingPatch / pendingPlan / selectedOpIds：写工具产出的变更预览；
 *  - continueAssistant：轮次切换时复用同一条助手气泡，避免每轮留一条空白气泡。
 */
import { create } from 'zustand'
import type { AiChatMessage, AiErrorCode, AiReference, AiSessionMessage } from '@/core/ai-types'
import type { AgentPatch, PatchPlan } from '../patch/agentPatchTypes'
import type { AgentDelegateResult } from '../tools/toolTypes'

export interface ToolCallRecord {
  callId: string
  toolId: string
  kind: 'result' | 'patch' | 'error' | 'delegate'
  summary: string
}

export interface ToolRoundRecord {
  round: number
  calls: ToolCallRecord[]
}

/** S3：一次子智能体委托的可复盘卡片。 */
export interface DelegationRecord extends AgentDelegateResult {
  id: string
  parentTaskId: string
  createdAt: number
}

interface AgentSessionState {
  messages: AiChatMessage[]
  status: 'idle' | 'streaming'
  taskId: string | null
  /** 已接收的最大 chunk 序号；重复或乱序推送直接丢弃。 */
  lastSeq: number
  error: { code: AiErrorCode; message: string } | null
  /** P2：一次任务的轮次序号（0 起）。 */
  toolRound: number
  toolRounds: ToolRoundRecord[]
  pendingPatch: AgentPatch | null
  pendingPlan: PatchPlan | null
  selectedOpIds: string[]
  /** S3：委托卡片跨消息保留，只在「新建会话」时清空。 */
  delegations: DelegationRecord[]
  /** P3：[ref:i] → docId 映射，只在内存；外发文本永远不含 docId / 磁盘路径。 */
  references: AiReference[]
  addUserMessage: (content: string, meta?: { agentId?: string; reasoningMode?: 'off' | 'on' | 'auto' }) => void
  startAssistant: (taskId: string) => void
  /** 轮次切换：只换 taskId 与 seq，不新建气泡、不退出 streaming。 */
  continueAssistant: (taskId: string, round: number) => void
  appendDelta: (taskId: string, seq: number | undefined, delta: string) => void
  /** 把说明写进当前流式气泡（与 appendAssistantNote 的「另起一条」区分）。 */
  appendAssistantText: (content: string) => void
  appendAssistantNote: (content: string) => void
  finish: (taskId: string, cancelled: boolean) => void
  fail: (code: AiErrorCode, message: string, taskId?: string) => void
  recordToolRound: (record: ToolRoundRecord) => void
  recordDelegation: (record: DelegationRecord) => void
  /** 同一 ref 编号以最新一次检索为准，避免多轮 kb.ask 留下旧映射。 */
  recordReferences: (references: readonly AiReference[]) => void
  setPendingPatch: (patch: AgentPatch, plan: PatchPlan) => void
  toggleOp: (opId: string) => void
  clearPendingPatch: () => void
  clearError: () => void
  /** P4-S：换入指定历史会话的正文，同时清空所有只在内存里的运行时状态。 */
  hydrate: (messages: readonly AiSessionMessage[]) => void
  clearSession: () => void
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const EMPTY_TOOL_STATE = {
  toolRound: 0,
  toolRounds: [] as ToolRoundRecord[],
  pendingPatch: null,
  pendingPlan: null,
  selectedOpIds: [] as string[],
  references: [] as AiReference[],
}

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  messages: [],
  status: 'idle',
  taskId: null,
  lastSeq: 0,
  error: null,
  ...EMPTY_TOOL_STATE,
  delegations: [],

  addUserMessage: (content, meta) => set((state) => ({
    messages: [...state.messages, { id: newId('user'), role: 'user', content, ...(meta ?? {}) }],
    error: null,
    ...EMPTY_TOOL_STATE,
  })),

  startAssistant: (taskId) => set((state) => ({
    taskId,
    status: 'streaming',
    lastSeq: 0,
    error: null,
    messages: [...state.messages, { id: newId('assistant'), role: 'assistant', content: '', streaming: true }],
  })),

  continueAssistant: (taskId, round) => set((state) => {
    if (state.status !== 'streaming') return state
    return { taskId, lastSeq: 0, toolRound: round }
  }),

  appendDelta: (taskId, seq, delta) => set((state) => {
    if (state.status !== 'streaming' || state.taskId !== taskId || !delta) return state
    // 幂等：主进程为每个 chunk 编了单调递增序号，重复订阅 / IPC 重发 / 迟到帧
    // 都不会把同一个 token 拼进回答两次。旧版主进程无 seq 时退化为不去重。
    if (typeof seq === 'number' && seq <= state.lastSeq) return state
    const last = state.messages[state.messages.length - 1]
    if (!last || last.role !== 'assistant') return state
    const updated: AiChatMessage = { ...last, content: last.content + delta }
    return {
      messages: [...state.messages.slice(0, -1), updated],
      lastSeq: typeof seq === 'number' ? seq : state.lastSeq,
    }
  }),

  // 轮次上限收尾用：说明与随后流式的最终答复必须落在同一条气泡里，
  // 否则原本那条空占位会永远留在面板上显示「正在生成…」。
  appendAssistantText: (content) => set((state) => {
    const last = state.messages[state.messages.length - 1]
    if (last && last.role === 'assistant') {
      return {
        messages: [...state.messages.slice(0, -1), { ...last, content: last.content + content }],
      }
    }
    return { messages: [...state.messages, { id: newId('assistant'), role: 'assistant', content }] }
  }),

  appendAssistantNote: (content) => set((state) => ({
    messages: [...state.messages, { id: newId('assistant'), role: 'assistant', content }],
  })),

  finish: (taskId, cancelled) => set((state) => {
    if (state.taskId !== taskId || state.status !== 'streaming') return state
    const last = state.messages[state.messages.length - 1]
    let messages = state.messages
    if (last && last.role === 'assistant') {
      if (last.content === '' && !cancelled) {
        // 纯工具轮次没有正文：移除空白气泡，不留空洞。
        messages = state.messages.slice(0, -1)
      } else {
        const content = last.content || (cancelled ? '（已停止生成）' : '')
        messages = [...state.messages.slice(0, -1), { ...last, content, streaming: false }]
      }
    }
    return { messages, status: 'idle', taskId: null, lastSeq: 0 }
  }),

  fail: (code, message, taskId) => set((state) => {
    // 旧任务迟到的错误不能打断已经开启的新会话。
    if (taskId && state.taskId !== taskId) return state
    const last = state.messages[state.messages.length - 1]
    // 失败时移除那条空的流式占位，避免留一条空白气泡。
    const messages = last?.role === 'assistant' && last.content === ''
      ? state.messages.slice(0, -1)
      : state.messages.map((item) => ({ ...item, streaming: false }))
    return {
      messages, status: 'idle', taskId: null, lastSeq: 0,
      error: { code, message },
      pendingPatch: null, pendingPlan: null, selectedOpIds: [],
    }
  }),

  recordToolRound: (record) => set((state) => ({ toolRounds: [...state.toolRounds, record] })),

  recordDelegation: (record) => set((state) => ({
    delegations: [...state.delegations.filter((item) => item.id !== record.id), record].slice(-20),
  })),

  recordReferences: (references) => set((state) => {
    const merged = new Map(state.references.map((item) => [item.ref, item]))
    for (const item of references) merged.set(item.ref, item)
    return { references: [...merged.values()].sort((a, b) => a.ref - b.ref).slice(-20) }
  }),

  setPendingPatch: (patch, plan) => set({
    pendingPatch: patch,
    pendingPlan: plan,
    selectedOpIds: plan.items.filter((item) => item.status === 'ready').map((item) => item.opId),
  }),

  toggleOp: (opId) => set((state) => ({
    selectedOpIds: state.selectedOpIds.includes(opId)
      ? state.selectedOpIds.filter((id) => id !== opId)
      : [...state.selectedOpIds, opId],
  })),

  clearPendingPatch: () => set({ pendingPatch: null, pendingPlan: null, selectedOpIds: [] }),

  clearError: () => set({ error: null }),

  hydrate: (messages) => set({
    messages: messages.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      ...(item.agentId ? { agentId: item.agentId } : {}),
      ...(item.reasoningMode ? { reasoningMode: item.reasoningMode } : {}),
    })),
    status: 'idle', taskId: null, lastSeq: 0, error: null,
    ...EMPTY_TOOL_STATE, delegations: [],
  }),

  // 取消流式请求由面板负责发 IPC；这里只重置状态，避免反向依赖 core/ai-backend。
  clearSession: () => set({
    messages: [], status: 'idle', taskId: null, lastSeq: 0, error: null,
    ...EMPTY_TOOL_STATE, delegations: [],
  }),
}))
