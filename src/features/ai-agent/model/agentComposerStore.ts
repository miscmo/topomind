/**
 * AI 输入框的轻量本地数据：输入历史 + 自定义快捷回复。
 *
 * 与 agentPreferencesStore 同口径：纯 UI 数据、只进 localStorage、不触发 IPC、
 * 不进主进程文件。项目有「base64 正文撑爆 localStorage」的教训，因此这里对
 * 条数、单条长度、总字符数三重钳制，并且读取时逐项校验 —— 存档损坏、
 * 类型不对、超长内容一律裁剪/丢弃，绝不把脏数据渲染到界面上。
 *
 * 会话正文的持久化走 agentSessionListStore → sessions.json，本 store 只记
 * 「用户敲过什么」，两者互不相干。
 */
import { create } from 'zustand'

const HISTORY_KEY = 'topomind:ai-input-history'
const QUICK_KEY = 'topomind:ai-quick-replies'

const MAX_HISTORY = 30
const MAX_QUICK = 12
const MAX_TEXT = 300
const MAX_CHARS = 6000

/** 内置常用回复。不含项目敏感词，点击即发送；用户可在此基础上追加自定义项。 */
export const DEFAULT_QUICK_REPLIES: readonly string[] = [
  '继续',
  '开始落地',
  '再详细一点',
  '给个具体示例',
  '帮我检查一遍',
  '换个思路',
  '总结一下',
]

/** 历史保留换行（回填输入框要还原原文）；快捷回复是单行胶囊，压平空白。 */
function normalizeText(raw: string, collapseWhitespace: boolean): string {
  const text = raw.trim().slice(0, MAX_TEXT)
  return collapseWhitespace ? text.replace(/\s+/g, ' ') : text
}

function readList(key: string, limit: number, collapseWhitespace: boolean): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: string[] = []
    let chars = 0
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const text = normalizeText(item, collapseWhitespace)
      if (!text || result.includes(text)) continue
      if (result.length >= limit || chars + text.length > MAX_CHARS) break
      result.push(text)
      chars += text.length
    }
    return result
  } catch {
    // JSON 损坏 / 隐私模式：退化为空列表，不抛到渲染层。
    return []
  }
}

function writeList(key: string, list: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // 配额不足时本次会话内仍可用，不阻断输入。
  }
}

interface AgentComposerState {
  /** 最近发送过的输入，最新的在最前。 */
  inputHistory: string[]
  /** 用户追加的快捷回复，展示时拼在 DEFAULT_QUICK_REPLIES 之后。 */
  customQuickReplies: string[]
  /**
   * 「让 AI 修改」入口写入的一次性预填文本。只进内存、不落 localStorage：
   * 这是跨模块的一次性交接信号，不是用户输入历史。
   */
  pendingDraft: string | null
  setPendingDraft: (text: string | null) => void
  pushInput: (text: string) => void
  clearInputHistory: () => void
  /** 返回是否真的新增（空串 / 重复 / 已达上限时为 false）。 */
  addQuickReply: (text: string) => boolean
  removeQuickReply: (text: string) => void
}

export const useAgentComposerStore = create<AgentComposerState>((set, get) => ({
  inputHistory: readList(HISTORY_KEY, MAX_HISTORY, false),
  customQuickReplies: readList(QUICK_KEY, MAX_QUICK, true),
  pendingDraft: null,

  setPendingDraft: (text) => set({ pendingDraft: text }),

  pushInput: (raw) => {
    const text = normalizeText(raw, false)
    if (!text) return
    const next = [text, ...get().inputHistory.filter((item) => item !== text)].slice(0, MAX_HISTORY)
    writeList(HISTORY_KEY, next)
    set({ inputHistory: next })
  },

  clearInputHistory: () => {
    writeList(HISTORY_KEY, [])
    set({ inputHistory: [] })
  },

  addQuickReply: (raw) => {
    const text = normalizeText(raw, true)
    const current = get().customQuickReplies
    if (!text || current.length >= MAX_QUICK
      || DEFAULT_QUICK_REPLIES.includes(text) || current.includes(text)) return false
    const next = [...current, text]
    writeList(QUICK_KEY, next)
    set({ customQuickReplies: next })
    return true
  },

  removeQuickReply: (text) => {
    const next = get().customQuickReplies.filter((item) => item !== text)
    writeList(QUICK_KEY, next)
    set({ customQuickReplies: next })
  },
}))

/** 供组件展示：内置项在前，自定义项在后，天然去重。 */
export function allQuickReplies(custom: readonly string[]): string[] {
  return [...DEFAULT_QUICK_REPLIES, ...custom.filter((item) => !DEFAULT_QUICK_REPLIES.includes(item))]
}
