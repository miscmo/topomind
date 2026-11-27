/**
 * AI 会话 tab 栏（P4-T）：只保存「已经在 tab 栏里打开的会话 id 列表」。
 *
 * 职责边界：
 *  - 会话正文仍由 agentSessionListStore / 主进程 sessions.json 负责，本 store
 *    不复制任何消息，也不参与写盘；localStorage 里只放短文本 id 数组
 *    （沿用项目「base64 撑爆 localStorage」的教训，绝不放正文）。
 *  - 单向订阅 agentSessionListStore：activeSessionId 变化（新建 / 切换 / 重启恢复 /
 *    删除后补位）自动把目标会话挂进 tab 栏；summaries 变化自动剔除已删除会话；
 *    resetForWorkspace 把 activeSessionId 归零时清空整组 tab。
 *  - 因此 listStore 一行都不用改：从历史浮窗点开一个「未打开」的会话会自然
 *    新增 tab，点「已打开」的会话只会切换激活态，不会重复插入。
 */
import { create } from 'zustand'
import { useAgentSessionListStore } from './agentSessionListStore'

const OPEN_TABS_KEY = 'topomind:ai-open-session-tabs'
/** tab 只是快速入口，上限防止 id 数组在 localStorage 里无限增长。 */
const MAX_OPEN_TABS = 24

interface AgentSessionTabsState {
  openSessionIds: string[]
  ensureTab: (id: string) => void
  removeTab: (id: string) => void
  /** 只保留仍在当前工作区会话列表里的 id。 */
  prune: (validIds: ReadonlySet<string>) => void
  reset: () => void
}

function readOpenIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OPEN_TABS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    return [...new Set(ids)].slice(0, MAX_OPEN_TABS)
  } catch {
    return []
  }
}

function persist(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    if (ids.length === 0) window.localStorage.removeItem(OPEN_TABS_KEY)
    else window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids))
  } catch {
    // 隐私模式 / 配额不足：只影响下次启动的 tab 恢复，不影响会话正文。
  }
}

export const useAgentSessionTabsStore = create<AgentSessionTabsState>((set, get) => ({
  openSessionIds: readOpenIds(),

  ensureTab: (id) => {
    const ids = get().openSessionIds
    if (ids.includes(id)) return
    const next = [...ids, id].slice(-MAX_OPEN_TABS)
    persist(next)
    set({ openSessionIds: next })
  },

  removeTab: (id) => {
    const ids = get().openSessionIds
    if (!ids.includes(id)) return
    const next = ids.filter((item) => item !== id)
    persist(next)
    set({ openSessionIds: next })
  },

  prune: (validIds) => {
    const ids = get().openSessionIds
    const next = ids.filter((id) => validIds.has(id))
    if (next.length === ids.length) return
    persist(next)
    set({ openSessionIds: next })
  },

  reset: () => {
    persist([])
    set({ openSessionIds: [] })
  },
}))

// 订阅在模块加载时建立。AgentPanel 挂载后还会显式 ensureTab 一次 activeSessionId，
// 兜住「订阅建立得比 ensureLoaded 晚」的时序，避免首次进入时 tab 栏空白。
useAgentSessionListStore.subscribe((state, previous) => {
  if (state.activeSessionId === null && previous.activeSessionId !== null) {
    useAgentSessionTabsStore.getState().reset()
    return
  }
  if (state.activeSessionId && state.activeSessionId !== previous.activeSessionId) {
    useAgentSessionTabsStore.getState().ensureTab(state.activeSessionId)
  }
  if (state.summaries !== previous.summaries) {
    useAgentSessionTabsStore.getState().prune(new Set(state.summaries.map((item) => item.id)))
  }
})
