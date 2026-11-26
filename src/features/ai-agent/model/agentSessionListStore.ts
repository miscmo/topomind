/**
 * 历史会话列表 + 持久化编排（P4-S）。
 *
 * 职责边界：
 *  - agentSessionStore 仍是「当前活动会话」的唯一运行时真源，本 store 不复制一份消息；
 *  - 本 store 只持有列表摘要、当前会话 id 与加载状态，订阅前者 messages 变化后
 *    debounce（350ms，流式期间最多 1.5s 一次）把快照交给主进程写 sessions.json；
 *  - activeSessionId 只存一个 id 到 localStorage（绝不放正文，沿用
 *    agentPreferencesStore 的口径），实现「重新打开软件自动恢复上次会话」；
 *  - 工具明细 / 变更预览 / 委托卡片 / [ref:i] 映射按 C10 / C15 不落盘。
 *
 * 降级：IPC 不可用（未进入工作目录 / 磁盘只读）时退回纯内存对话，
 * 不阻断发送，只在列表里给出错误提示。
 */
import { create } from 'zustand'
import {
  cancelAiChat,
  deleteAiSession,
  getAiSession,
  listAiSessions,
  upsertAiSession,
} from '@/core/ai-backend'
import type { AiSessionMessage, AiSessionRecord, AiSessionSummary } from '@/core/ai-types'
import { abortToolRun } from './agentToolLoop'
import { useAgentSessionStore } from './agentSessionStore'

const ACTIVE_SESSION_KEY = 'topomind:ai-active-session'
const SAVE_DEBOUNCE_MS = 350
const SAVE_MAX_WAIT_MS = 1500
const TITLE_MAX = 24

interface AgentSessionListState {
  summaries: AiSessionSummary[]
  activeSessionId: string | null
  loaded: boolean
  loading: boolean
  error: string | null
  ensureLoaded: () => Promise<void>
  newSession: () => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  /** 切换 / 退出工作目录时清空内存镜像，避免把旧工作区的会话带过去。 */
  resetForWorkspace: () => void
}

let inflight: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let firstPendingAt = 0
/** 只有正文真的变过才写盘；切换 / 删除前的 flush 不会重复回写整个会话。 */
let dirty = false
let hydrating = false
let writeChain: Promise<unknown> = Promise.resolve()
/** 每次 reset 递增：在途 IPC 完成后不得把旧工作区的列表写回新状态。 */
let generation = 0

function newSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function readActiveId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_KEY)
  } catch {
    return null
  }
}

function writeActiveId(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_SESSION_KEY)
    else window.localStorage.setItem(ACTIVE_SESSION_KEY, id)
  } catch {
    // 隐私模式 / 配额不足：仅本次运行可恢复，不影响对话。
  }
}

function deriveTitle(messages: readonly AiSessionMessage[]): string {
  const first = messages.find((item) => item.role === 'user' && item.content.trim())
  if (!first) return '新会话'
  const text = first.content.replace(/\s+/g, ' ').trim()
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

function emptyRecord(id: string): AiSessionRecord {
  const now = Date.now()
  return { id, title: '新会话', createdAt: now, updatedAt: now, messages: [] }
}

function upsertSummary(list: AiSessionSummary[], next: AiSessionSummary): AiSessionSummary[] {
  return [next, ...list.filter((item) => item.id !== next.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function fallbackSummary(record: AiSessionRecord): AiSessionSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '历史会话不可用'
}

/** 换入历史正文；hydrating 期间自动保存订阅不写盘，避免刚载入就回写一次。 */
function hydrateFrom(record: AiSessionRecord | null) {
  hydrating = true
  try {
    useAgentSessionStore.getState().hydrate(record?.messages ?? [])
  } finally {
    hydrating = false
  }
}

/** 终止在途工具编排与流式请求；迟到的 chunk / done 会被 store 的 taskId 校验丢弃。 */
function abortCurrentRun() {
  const taskId = useAgentSessionStore.getState().taskId
  abortToolRun()
  if (taskId) cancelAiChat(taskId)
}

function buildSnapshot(): AiSessionRecord | null {
  const listState = useAgentSessionListStore.getState()
  const id = listState.activeSessionId
  if (!listState.loaded || !id || hydrating) return null
  const previous = listState.summaries.find((item) => item.id === id)
  const messages: AiSessionMessage[] = useAgentSessionStore.getState().messages.map((item) => ({
    id: item.id,
    role: item.role,
    content: item.content,
    ...(item.agentId ? { agentId: item.agentId } : {}),
    ...(item.reasoningMode ? { reasoningMode: item.reasoningMode } : {}),
  }))
  return {
    id,
    title: deriveTitle(messages),
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    messages,
  }
}

function cancelPendingSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  firstPendingAt = 0
}

/** 串行写盘：后一次一定不会覆盖先一次，且快照在真正写入前才读取最新 state。 */
function flushSave(): Promise<void> {
  cancelPendingSave()
  const shouldWrite = dirty
  dirty = false
  if (!shouldWrite) return Promise.resolve()
  const gen = generation
  const write = writeChain.catch(() => undefined).then(async () => {
    const payload = buildSnapshot()
    if (!payload) return
    const summary = await upsertAiSession(payload)
    if (gen !== generation) return
    useAgentSessionListStore.setState((state) => ({
      summaries: upsertSummary(state.summaries, summary),
    }))
  })
  writeChain = write
  return write.catch((error) => {
    if (gen !== generation) return
    // 保留脏标记：下一次操作 / 关闭窗口时还能再试一次，不静默丢改动。
    dirty = true
    useAgentSessionListStore.setState({ error: `保存历史会话失败：${errorMessage(error)}` })
  })
}

function scheduleSave() {
  dirty = true
  if (saveTimer) clearTimeout(saveTimer)
  const now = Date.now()
  if (!firstPendingAt) firstPendingAt = now
  // 流式 token 会不断重置 debounce；maxWait 保证回答生成过程中也周期性落盘。
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - (now - firstPendingAt)))
  saveTimer = setTimeout(() => {
    saveTimer = null
    firstPendingAt = 0
    void flushSave()
  }, wait)
}

// 应用级一条管道：只在对话正文变化时触发，工具明细 / 预览 / 引用都不触发写盘。
useAgentSessionStore.subscribe((state, previous) => {
  if (state.messages === previous.messages || hydrating) return
  const listState = useAgentSessionListStore.getState()
  if (!listState.loaded || !listState.activeSessionId) return
  scheduleSave()
})

async function safeUpsert(record: AiSessionRecord): Promise<AiSessionSummary | null> {
  try {
    return await upsertAiSession(record)
  } catch (error) {
    useAgentSessionListStore.setState({ error: `保存历史会话失败：${errorMessage(error)}` })
    return null
  }
}

async function loadSessions(): Promise<void> {
  const gen = generation
  const result = await listAiSessions()
  const summaries = Array.isArray(result?.sessions) ? result.sessions : []
  const savedId = readActiveId()
  let targetId = summaries.find((item) => item.id === savedId)?.id ?? summaries[0]?.id ?? null
  let nextSummaries = summaries
  if (!targetId) {
    // 首次进入：落一条空会话，后续对话自动挂到它下面。
    const created = emptyRecord(newSessionId())
    const summary = await safeUpsert(created) ?? fallbackSummary(created)
    nextSummaries = [summary]
    targetId = created.id
  }
  let record: AiSessionRecord | null = null
  try {
    record = await getAiSession(targetId)
  } catch (error) {
    useAgentSessionListStore.setState({ error: `读取历史会话失败：${errorMessage(error)}` })
  }
  if (gen !== generation) return
  hydrateFrom(record ?? emptyRecord(targetId))
  writeActiveId(targetId)
  useAgentSessionListStore.setState({
    summaries: nextSummaries,
    activeSessionId: targetId,
    loaded: true,
    loading: false,
    error: null,
  })
}

export const useAgentSessionListStore = create<AgentSessionListState>((set, get) => ({
  summaries: [],
  activeSessionId: null,
  loaded: false,
  loading: false,
  error: null,

  ensureLoaded: () => {
    if (get().loaded) return Promise.resolve()
    if (inflight) return inflight
    set({ loading: true, error: null })
    const gen = generation
    inflight = loadSessions()
      .catch((error) => {
        if (gen !== generation) return
        // IPC 不可用时退回纯内存对话：清空运行时，不假装已持久化。
        hydrateFrom(null)
        set({ summaries: [], activeSessionId: null, loaded: true, error: errorMessage(error) })
      })
      .finally(() => {
        set({ loading: false })
        inflight = null
      })
    return inflight
  },

  newSession: async () => {
    await get().ensureLoaded()
    const state = get()
    if (!state.activeSessionId) {
      // 降级模式：仍然允许「新建会话」清空当前对话。
      abortCurrentRun()
      hydrateFrom(null)
      return
    }
    await flushSave()
    const current = state.summaries.find((item) => item.id === state.activeSessionId)
    const isBlank = (current?.messageCount ?? 0) === 0
      && useAgentSessionStore.getState().messages.length === 0
    abortCurrentRun()
    if (isBlank) {
      // 连续点击「新建」不产生一串空会话；复用当前空白会话。
      hydrateFrom(null)
      return
    }
    const created = emptyRecord(newSessionId())
    const summary = await safeUpsert(created) ?? fallbackSummary(created)
    hydrateFrom(created)
    writeActiveId(created.id)
    set((prev) => ({
      summaries: upsertSummary(prev.summaries, summary),
      activeSessionId: created.id,
      error: null,
    }))
  },

  switchSession: async (id) => {
    await get().ensureLoaded()
    const state = get()
    if (!state.activeSessionId || id === state.activeSessionId) return
    if (!state.summaries.some((item) => item.id === id)) return
    await flushSave()
    abortCurrentRun()
    hydrateFrom(null)
    let record: AiSessionRecord | null = null
    try {
      record = await getAiSession(id)
    } catch (error) {
      set({ error: `读取历史会话失败：${errorMessage(error)}` })
    }
    hydrateFrom(record ?? emptyRecord(id))
    writeActiveId(id)
    set({ activeSessionId: id, error: null })
  },

  deleteSession: async (id) => {
    await get().ensureLoaded()
    const state = get()
    if (!state.summaries.some((item) => item.id === id)) return
    const deletingActive = id === state.activeSessionId
    if (deletingActive) {
      await flushSave()
      abortCurrentRun()
    }
    try {
      await deleteAiSession(id)
    } catch (error) {
      set({ error: `删除历史会话失败：${errorMessage(error)}` })
      return
    }
    let summaries = get().summaries.filter((item) => item.id !== id)
    if (summaries.length === 0) {
      // 列表始终保留一条，避免每次删空都要走「首次进入」分支。
      const created = emptyRecord(newSessionId())
      const summary = await safeUpsert(created) ?? fallbackSummary(created)
      summaries = [summary]
    }
    set({ summaries, error: null })
    if (deletingActive) {
      const nextId = summaries[0].id
      const record = await getAiSession(nextId).catch(() => null)
      hydrateFrom(record ?? emptyRecord(nextId))
      writeActiveId(nextId)
      set({ activeSessionId: nextId })
    }
  },

  resetForWorkspace: () => {
    generation += 1
    inflight = null
    dirty = false
    cancelPendingSave()
    hydrateFrom(null)
    set({ summaries: [], activeSessionId: null, loaded: false, loading: false, error: null })
  },
}))

/** 窗口关闭前尽力把最后一次 debounce 里的改动写盘（Electron  IPC 同步落盘很快）。 */
export function flushAgentSessionSave(): void {
  void flushSave()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushAgentSessionSave())
}
