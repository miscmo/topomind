/**
 * AI 会话的纯 UI 偏好（P0 字号 + S1 深度思考三态）。
 *
 * 与 themeStore 同口径：全局界面偏好、不绑工作区、只存枚举字符串到
 * localStorage（绝不放大段内容，项目已有 base64 撑爆 localStorage 的教训）。
 * 不进主进程 ai/config.json —— 不需要跨进程、不需要加密、也不该触发 IPC 审计。
 *
 * 深度思考的优先级（docs/design §15.7）：**会话覆盖 > Agent 定义 > 全局默认**。
 * reasoningMode 为 null 表示「跟随当前 Agent 定义」，三态按钮会写入具体值；
 * 「恢复为该 Agent 默认」把值清回 null。非法存档值一律回落，不抛错。
 */
import { create } from 'zustand'
import {
  isReasoningMode,
  isReasoningProtocol,
  type ReasoningMode,
  type ReasoningProtocol,
} from '../config/agentTypes'

export type AiChatFontSize = 'small' | 'medium' | 'large'

export const DEFAULT_AI_CHAT_FONT_SIZE: AiChatFontSize = 'medium'

export const AI_CHAT_FONT_SIZE_OPTIONS: ReadonlyArray<{ value: AiChatFontSize; label: string; hint: string }> = [
  { value: 'small', label: '小', hint: '紧凑' },
  { value: 'medium', label: '中', hint: '默认' },
  { value: 'large', label: '大', hint: '接近旧版' },
]

const FONT_KEY = 'topomind:ai-chat-font-size'
const REASONING_MODE_KEY = 'topomind:ai-reasoning-mode'
const REASONING_PROTOCOL_KEY = 'topomind:ai-reasoning-protocol'

function normalizeFont(value: unknown): AiChatFontSize {
  return value === 'small' || value === 'medium' || value === 'large'
    ? value
    : DEFAULT_AI_CHAT_FONT_SIZE
}

/** null = 跟随 Agent 定义。存档里只有 'off' / 'on' / 'auto' 三个合法值。 */
function normalizeReasoningMode(value: unknown): ReasoningMode | null {
  return isReasoningMode(value) ? value : null
}

function normalizeReasoningProtocol(value: unknown): ReasoningProtocol {
  return isReasoningProtocol(value) ? value : 'auto'
}

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式 / 配额不足时降级为「本次会话有效」，不阻断设置操作。
  }
}

interface AgentPreferencesState {
  fontSize: AiChatFontSize
  reasoningMode: ReasoningMode | null
  reasoningProtocol: ReasoningProtocol
  setFontSize: (size: AiChatFontSize) => void
  setReasoningMode: (mode: ReasoningMode | null) => void
  setReasoningProtocol: (protocol: ReasoningProtocol) => void
}

export const useAgentPreferencesStore = create<AgentPreferencesState>((set) => ({
  fontSize: normalizeFont(read(FONT_KEY)),
  reasoningMode: normalizeReasoningMode(read(REASONING_MODE_KEY)),
  reasoningProtocol: normalizeReasoningProtocol(read(REASONING_PROTOCOL_KEY)),

  setFontSize: (size) => {
    const next = normalizeFont(size)
    write(FONT_KEY, next)
    set({ fontSize: next })
  },

  setReasoningMode: (mode) => {
    const next = normalizeReasoningMode(mode)
    write(REASONING_MODE_KEY, next)
    set({ reasoningMode: next })
  },

  setReasoningProtocol: (protocol) => {
    const next = normalizeReasoningProtocol(protocol)
    write(REASONING_PROTOCOL_KEY, next)
    set({ reasoningProtocol: next })
  },
}))
