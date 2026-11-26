/**
 * AI 会话输入区（P4-C）。
 *
 * 从 AgentPanel 抽离，专治三处旧问题：
 *   1) 旧 textarea 复用单行 .tm-input（固定 28px + 上下 0 padding），文字贴顶、
 *      上下间隙不对称；现在用 .tm-composer-input，上下 padding 对称且高度随内容走。
 *   2) 旧 rows={3} 被固定 height 压住，多行只能靠原生滚动条；现在按 scrollHeight
 *      自适应，只有超过 CSS max-height 才由 .tm-scroll 细滚动条接管。
 *   3) 补齐成熟 Agent 输入区该有的辅助能力：一键快捷回复、输入历史回填。
 *
 * 兼容性契约：textarea 保留 data-tm-ai-composer（多个 GUI 冒烟用 page.type 定位），
 * 发送按钮保留「发送」文字（verify-ai-agent-gui 按按钮文本点击）；240 窄栏下
 * chips 行横向滚动、提示文字 truncate，面板绝不产生横向溢出。
 */
import { useEffect, useRef, useState } from 'react'
import { History, Plus, Send, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { allQuickReplies, useAgentComposerStore } from '../model/agentComposerStore'

interface AgentComposerProps {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  /** 有未处理的变更预览时禁止发送，避免两份 pendingPatch 互相覆盖。 */
  blocked: boolean
  fontClass: string
}

export default function AgentComposer({
  value, onChange, onSend, onStop, streaming, blocked, fontClass,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const inputHistory = useAgentComposerStore((state) => state.inputHistory)
  const customQuickReplies = useAgentComposerStore((state) => state.customQuickReplies)
  const clearInputHistory = useAgentComposerStore((state) => state.clearInputHistory)
  const addQuickReply = useAgentComposerStore((state) => state.addQuickReply)
  const removeQuickReply = useAgentComposerStore((state) => state.removeQuickReply)
  const quickReplies = allQuickReplies(customQuickReplies)
  const canSend = !streaming && !blocked
  const normalizedDraft = value.trim().replace(/\s+/g, ' ')
  const canAddQuick = Boolean(normalizedDraft) && !quickReplies.includes(normalizedDraft)

  // 先回 auto 让浏览器量出真实内容高度，再写回 px；CSS 的 max-height 负责钳制。
  // 字号偏好变化也要重算，否则大字号下会少算一行。
  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value, fontClass])

  const submit = (raw: string) => {
    const text = raw.trim()
    if (!text || !canSend) return
    onChange('')
    onSend(text)
  }

  const restoreFromHistory = (text: string) => {
    onChange(text)
    setShowHistory(false)
    // 等 React 把 value 写回 DOM 后再聚焦并把光标放到末尾。
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      const end = node.value.length
      node.setSelectionRange(end, end)
    })
  }

  const addCurrentAsQuickReply = () => {
    if (!canAddQuick) return
    if (addQuickReply(value)) onChange('')
  }

  return (
    <div className="shrink-0 border-t border-[var(--color-border-light)] p-2" data-tm-ai-composer-host="">
      {/* 快捷回复：默认项 + 用户自定义项，窄栏横向滚动，不挤占消息区宽度。 */}
      <div className="mb-2 flex min-w-0 items-center gap-1" data-tm-ai-composer-chips="">
        <div className={tmUI(TM_UI.composerChips, 'min-w-0 flex-1 py-0.5')}>
          {quickReplies.map((text) => {
            const isCustom = customQuickReplies.includes(text)
            return (
              <span key={text} className="inline-flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  disabled={!canSend}
                  title={`一键发送：${text}`}
                  onClick={() => onSend(text)}
                  className={TM_UI.chipButton}
                  data-tm-ai-quick-reply={text}
                >
                  {text}
                </button>
                {isCustom && (
                  <button
                    type="button"
                    title={`删除快捷回复：${text}`}
                    aria-label={`删除快捷回复：${text}`}
                    onClick={() => removeQuickReply(text)}
                    className={TM_UI.iconButton}
                    data-tm-ai-quick-reply-remove={text}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <button
          type="button"
          disabled={!canAddQuick}
          title="把当前输入存为快捷回复（会清空输入框）"
          aria-label="添加快捷回复"
          onClick={addCurrentAsQuickReply}
          className={TM_UI.iconButton}
          data-tm-ai-quick-add=""
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {showHistory && (
        <div
          className={tmUI(TM_UI.composerHistory, TM_UI.scroll, 'mb-2 max-h-40 overflow-y-auto p-1.5')}
          data-tm-ai-input-history=""
        >
          <div className="mb-1 flex items-center justify-between gap-1">
            <span className="tm-hint">输入历史 · {inputHistory.length}</span>
            <button
              type="button"
              disabled={inputHistory.length === 0}
              onClick={clearInputHistory}
              className={TM_UI.button}
              data-tm-ai-input-history-clear=""
            >
              清空
            </button>
          </div>
          {inputHistory.length === 0 ? (
            <div className="tm-hint px-1 py-1">暂无记录，发送过的输入会出现在这里</div>
          ) : inputHistory.map((text, index) => (
            <button
              key={`${index}-${text.slice(0, 16)}`}
              type="button"
              title={text}
              onClick={() => restoreFromHistory(text)}
              className={tmUI(TM_UI.buttonGhost, 'mb-0.5 w-full min-w-0 px-1.5 text-left')}
              data-tm-ai-input-history-item={index}
            >
              <span className="block min-w-0 truncate">{text.replace(/\n/g, ' ↵ ')}</span>
            </button>
          ))}
        </div>
      )}

      <div className={TM_UI.composer}>
        <textarea
          ref={textareaRef}
          aria-label="向 AI 提问"
          data-tm-ai-composer=""
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // 中文输入法选词时的 Enter 不能当成发送。
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit(value)
            }
          }}
          rows={1}
          placeholder="输入问题…"
          className={tmUI(TM_UI.composerInput, TM_UI.scroll, fontClass)}
        />
        <div className={TM_UI.composerFoot} data-tm-ai-composer-foot="">
          <button
            type="button"
            title="输入历史"
            aria-label="输入历史"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((prev) => !prev)}
            className={showHistory ? TM_UI.buttonActive : TM_UI.iconButton}
            data-tm-ai-input-history-toggle=""
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <span className="tm-hint min-w-0 flex-1 truncate">↵ 发送 · ⇧↵ 换行</span>
          {streaming ? (
            <button type="button" onClick={onStop} className={TM_UI.button}>
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(value)}
              disabled={!value.trim() || !canSend}
              className={tmUI(TM_UI.buttonPrimary, 'disabled:opacity-50')}
              data-tm-ai-send=""
            >
              <Send className="mr-1 inline h-3.5 w-3.5" />发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
