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
import { Bot, ChevronDown, History, Plus, Send, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { allQuickReplies, useAgentComposerStore } from '../model/agentComposerStore'
import { resolveModelId, useAiModelStore } from '../model/aiModelStore'
import { useAgentPreferencesStore } from '../model/agentPreferencesStore'
import { useAgentDefinitionStore } from '../model/agentDefinitionStore'
import { useAiSelectionStore } from '../model/aiSelectionStore'
import { targetForBlocks, targetForDocument } from '../model/aiSelectionActions'

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
  const modelPickerRef = useRef<HTMLDivElement | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const inputHistory = useAgentComposerStore((state) => state.inputHistory)
  const customQuickReplies = useAgentComposerStore((state) => state.customQuickReplies)
  const clearInputHistory = useAgentComposerStore((state) => state.clearInputHistory)
  const addQuickReply = useAgentComposerStore((state) => state.addQuickReply)
  const removeQuickReply = useAgentComposerStore((state) => state.removeQuickReply)
  const quickReplies = allQuickReplies(customQuickReplies)
  // 引用条：pinned 是用户主动附加的目标，下面两个按钮把「当前文档 / 光标所在块」
  // 一键转成引用。附加后 AI 发问会把 (docId, blockIds) 冻结进本轮信封。
  const pinned = useAiSelectionStore((state) => state.pinned)
  const documentId = useAiSelectionStore((state) => state.documentId)
  const documentTitle = useAiSelectionStore((state) => state.documentTitle)
  const documentNodeId = useAiSelectionStore((state) => state.documentNodeId)
  const blockIds = useAiSelectionStore((state) => state.blockIds)
  const blockExcerpt = useAiSelectionStore((state) => state.blockExcerpt)
  const pinTarget = useAiSelectionStore((state) => state.pinTarget)
  const unpinTarget = useAiSelectionStore((state) => state.unpinTarget)
  // P5：底栏模型选择器。显示的是「真正会生效」的模型（会话选择 > Agent 绑定 >
  // 全局默认）；切换只把短 id 存进 localStorage，下一次发问由 AgentPanel 解析并
  // 随本轮请求快照，中途切换不影响在途对话。
  const profiles = useAiModelStore((state) => state.profiles)
  const defaultModelId = useAiModelStore((state) => state.defaultModelId)
  const modelsLoaded = useAiModelStore((state) => state.loaded)
  const ensureModelsLoaded = useAiModelStore((state) => state.ensureLoaded)
  const sessionModelId = useAgentPreferencesStore((state) => state.sessionModelId)
  const setSessionModelId = useAgentPreferencesStore((state) => state.setSessionModelId)
  const agentConfig = useAgentDefinitionStore((state) => state.config)
  const activeAgentId = useAgentDefinitionStore((state) => state.activeAgentId)
  const agentModelId = agentConfig?.agents.find((item) => item.id === activeAgentId)?.modelId ?? null
  const activeModelId = resolveModelId(profiles, defaultModelId, sessionModelId, agentModelId)
  const activeModel = profiles.find((item) => item.id === activeModelId) ?? null
  const followModelId = resolveModelId(profiles, defaultModelId, null, agentModelId)
  const followModelName = profiles.find((item) => item.id === followModelId)?.name ?? '全局默认'
  const canSend = !streaming && !blocked
  const normalizedDraft = value.trim().replace(/\s+/g, ' ')
  const canAddQuick = Boolean(normalizedDraft) && !quickReplies.includes(normalizedDraft)

  // 工作区切换会清空模型镜像，loaded 变 false 时自动重拉新目录的配置。
  useEffect(() => { if (!modelsLoaded) void ensureModelsLoaded() }, [modelsLoaded, ensureModelsLoaded])

  // 点外部 / Esc 收起模型菜单；不拦截输入框的 Enter 发送。
  useEffect(() => {
    if (!showModels) return
    const onPointerDown = (event: PointerEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) setShowModels(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowModels(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [showModels])

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

  const pinCurrentDocument = () => {
    if (!documentId) return
    pinTarget(targetForDocument(documentId, documentTitle, documentNodeId))
  }
  const pinCurrentBlocks = () => {
    if (!documentId || blockIds.length === 0) return
    pinTarget(targetForBlocks(documentId, blockIds, `选中 ${blockIds.length} 个块`, blockExcerpt))
  }

  return (
    <div className="shrink-0 border-t border-[var(--color-border-light)] p-2" data-tm-ai-composer-host="">
      {pinned.length > 0 || documentId ? (
        <div className="mb-2 flex min-w-0 items-center gap-1" data-tm-ai-selection-refs="">
          <span className="tm-hint shrink-0">引用</span>
          <div className={tmUI(TM_UI.composerChips, 'min-w-0 flex-1 py-0.5')}>
            {pinned.map((target) => (
              <span key={target.id} className="inline-flex shrink-0 items-center gap-0.5">
                <span className={TM_UI.chipButton} title={`${target.kind}: ${target.id}`}>
                  {target.label}
                </span>
                <button
                  type="button"
                  title={`移除引用：${target.label}`}
                  aria-label={`移除引用：${target.label}`}
                  onClick={() => unpinTarget(target.id)}
                  className={TM_UI.iconButton}
                  data-tm-ai-selection-ref-remove={target.id}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {documentId ? (
              <button
                type="button"
                title={`附加当前文档 ${documentId}`}
                onClick={pinCurrentDocument}
                className={TM_UI.chipButton}
                data-tm-ai-selection-pin-document=""
              >
                + 当前文档
              </button>
            ) : null}
            {documentId && blockIds.length > 0 ? (
              <button
                type="button"
                title={`附加选中的 ${blockIds.length} 个块`}
                onClick={pinCurrentBlocks}
                className={TM_UI.chipButton}
                data-tm-ai-selection-pin-blocks=""
              >
                + 选中块 {blockIds.length}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
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
          <div className="relative shrink-0" ref={modelPickerRef} data-tm-ai-model-picker-host="">
            <button
              type="button"
              title={`当前模型：${activeModel?.name ?? followModelName}（点击切换）`}
              aria-label="切换模型"
              aria-expanded={showModels}
              onClick={() => setShowModels((prev) => !prev)}
              className={tmUI(TM_UI.pillButton, 'inline-flex h-6 items-center gap-1 px-1.5')}
              data-tm-ai-model-picker=""
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="max-w-[56px] truncate">{activeModel?.name ?? followModelName}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showModels && (
              <div
                role="menu"
                aria-label="选择生效模型"
                data-tm-ai-model-menu=""
                className={tmUI(TM_UI.menu, TM_UI.scroll, TM_UI.aiModelMenu, 'absolute bottom-full left-0 mb-1 max-h-64 w-48 overflow-y-auto')}
              >
                <button
                  type="button"
                  role="menuitem"
                  data-tm-ai-model-option=""
                  data-active={sessionModelId === null ? 'true' : undefined}
                  onClick={() => { setSessionModelId(null); setShowModels(false) }}
                  className={TM_UI.menuItem}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">跟随 Agent / 全局默认</span>
                    <span className="tm-hint block truncate">{followModelName}</span>
                  </span>
                </button>
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    role="menuitem"
                    data-tm-ai-model-option={profile.id}
                    data-active={sessionModelId === profile.id ? 'true' : undefined}
                    onClick={() => { setSessionModelId(profile.id); setShowModels(false) }}
                    className={TM_UI.menuItem}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{profile.name}{profile.id === defaultModelId ? ' · 默认' : ''}</span>
                      <span className="tm-hint block truncate">{profile.model}{profile.hasKey ? '' : ' · 未配置 Key'}</span>
                    </span>
                  </button>
                ))}
                {profiles.length === 0 && (
                  <span className="tm-hint block px-2 py-1">尚未配置模型，请在「AI 设置 → AI 助手」新增</span>
                )}
              </div>
            )}
          </div>
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
