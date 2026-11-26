/**
 * AI Agent 会话面板（P0 只读问答 → P2 tool calling）。
 *
 * 挂载点沿用 Left Dock 的 'agent' 页：NodeTreePanel / NavRail / store 零改动。
 * 所有模型请求都经 core/ai-backend → 主进程 AI 网关；这里不 fetch、不持有
 * 明文 API Key。工具执行体在渲染层，写操作一律经 PatchPreview 人工确认后
 * 才交给 commitAgentPatch —— 面板本身没有任何直接写业务数据的入口。
 *
 * 视觉值全部走 TM_UI / controls.css / 语义 token，避免新增设计系统违规。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, History, Plus, Send, Settings2, Sparkles, Wrench, X } from 'lucide-react'
import { EmptyState } from '@/shared/ui/EmptyState'
import { requestOpenDocumentLink } from '@/features/documents/SmartDocumentEditor/docLinkBridge'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { executeCommand } from '@/application/commands'
import {
  cancelAiChat,
  getAiConfig,
} from '@/core/ai-backend'
import type { AiChatAgentPayload, AiWireMessage } from '@/core/ai-types'
import AiMarkdown from './AiMarkdown'
import AgentSelector from './components/AgentSelector'
import DelegationCard from './components/DelegationCard'
import PatchPreview from './components/PatchPreview'
import SessionHistory from './components/SessionHistory'
import type { ReasoningMode } from './config/agentTypes'
import { buildPromptValues } from './config/promptValues'
import { renderPrompt } from './config/renderPrompt'
import { ensureAiEventBridge } from './model/aiEventBridge'
import { getActiveAgent, useAgentDefinitionStore } from './model/agentDefinitionStore'
import { useAgentPreferencesStore } from './model/agentPreferencesStore'
import { useAgentSessionListStore } from './model/agentSessionListStore'
import { useAgentSessionStore } from './model/agentSessionStore'
import { abortToolRun, applyPendingPatch, rejectPendingPatch, startToolRun } from './model/agentToolLoop'
import { useAgentToolRuntime } from './model/useAgentToolRuntime'

const BUBBLE_BASE = 'mb-3 rounded-lg border px-3 py-2'

// 流式事件只注册一条全局管道，不随组件挂载/卸载反复订阅（否则 token 会被重复追加）。
ensureAiEventBridge()

export default function AgentPanel() {
  const [draft, setDraft] = useState('')
  const [applying, setApplying] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const messages = useAgentSessionStore((state) => state.messages)
  const status = useAgentSessionStore((state) => state.status)
  const error = useAgentSessionStore((state) => state.error)
  const toolRounds = useAgentSessionStore((state) => state.toolRounds)
  const delegations = useAgentSessionStore((state) => state.delegations)
  const references = useAgentSessionStore((state) => state.references)
  const pendingPlan = useAgentSessionStore((state) => state.pendingPlan)
  const selectedOpIds = useAgentSessionStore((state) => state.selectedOpIds)
  const fontSize = useAgentPreferencesStore((state) => state.fontSize)
  const summaries = useAgentSessionListStore((state) => state.summaries)
  const activeSessionId = useAgentSessionListStore((state) => state.activeSessionId)
  const activeTitle = summaries.find((item) => item.id === activeSessionId)?.title ?? '新会话'
  const { runtime, workspaceApi } = useAgentToolRuntime()
  const isStreaming = status === 'streaming'
  const chatFontClass = fontSize === 'small'
    ? TM_UI.aiFontSmall
    : fontSize === 'large' ? TM_UI.aiFontLarge : TM_UI.aiFontMedium

  // P4-S：进入工作目录后恢复历史会话列表与上次打开的会话（幂等，多次挂载无副作用）。
  useEffect(() => {
    void useAgentSessionListStore.getState().ensureLoaded()
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, pendingPlan, toolRounds, delegations])

  const send = useCallback(async () => {
    const text = draft.trim()
    // 有未处理的变更预览时不再发起新任务，避免两份 pendingPatch 互相覆盖。
    if (!text || useAgentSessionStore.getState().status === 'streaming' || pendingPlan) return
    // P4-S：首次发送前确保会话列表已载入，否则本次对话不会被挂到历史会话下。
    await useAgentSessionListStore.getState().ensureLoaded()
    const store = useAgentSessionStore.getState()
    if (store.status === 'streaming' || store.pendingPlan) return
    const prefs = useAgentPreferencesStore.getState()
    const initialAgent = getActiveAgent()
    const effectiveMode: ReasoningMode = prefs.reasoningMode ?? initialAgent?.model.reasoning.mode ?? 'auto'
    setDraft('')
    const history: AiWireMessage[] = store.messages.map((item) => ({ role: item.role, content: item.content }))
    store.addUserMessage(text, { agentId: initialAgent?.id, reasoningMode: effectiveMode })
    const baseTaskId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    try {
      // 每次发送都重读配置：用户可能刚在设置页填完 Key，而面板一直挂载着。
      const config = await getAiConfig()
      if (!config.hasKey) {
        useAgentSessionStore.getState().fail('no_key', '尚未配置 API Key，请到「设置 → AI 助手」填写后再试')
        return
      }
      // S2：取当前 Agent → 渲染最终 prompt → 合并会话级深度思考覆盖，
      // 只把最终字符串与已钳制参数交给主进程，不传模板、不传密钥。
      await useAgentDefinitionStore.getState().ensureLoaded()
      const active = getActiveAgent()
      const chatAgent: AiChatAgentPayload | undefined = active ? {
        agentId: active.id,
        systemPrompt: renderPrompt(active.systemPrompt, buildPromptValues(active.toolIds), active.promptVars).prompt,
        model: active.model,
        reasoning: {
          mode: prefs.reasoningMode ?? active.model.reasoning.mode,
          protocol: prefs.reasoningProtocol ?? active.model.reasoning.protocol,
          effort: active.model.reasoning.effort,
        },
      } : undefined
      // P2：tools 快照由当前 Agent 的 toolIds 固定，一轮会话内不再变化。
      await startToolRun({
        baseTaskId,
        messages: [...history, { role: 'user', content: text }],
        agent: chatAgent,
        toolIds: active?.toolIds ?? [],
        runtime,
      })
    } catch {
      abortToolRun()
      useAgentSessionStore.getState().fail('network', '无法连接 AI 网关，请稍后重试')
    }
  }, [draft, pendingPlan, runtime])

  const stop = useCallback(() => {
    const taskId = useAgentSessionStore.getState().taskId
    abortToolRun()
    if (taskId) cancelAiChat(taskId)
    if (taskId) useAgentSessionStore.getState().finish(taskId, true)
  }, [])

  // P4-S：新建会话由 listStore 统一编排（flush 当前会话 → abort 在途任务 →
  // 落一条新空会话）。面板只清输入框，绝不直接 clearSession，否则会把尚未
  // 写盘的历史正文当成「空会话」回写覆盖。
  const newSession = useCallback(() => {
    setDraft('')
    void useAgentSessionListStore.getState().newSession()
  }, [])

  const applyPatch = useCallback(async () => {
    setApplying(true)
    try {
      await applyPendingPatch(workspaceApi)
    } finally {
      setApplying(false)
    }
  }, [workspaceApi])

  const openSettings = useCallback(() => {
    void executeCommand('nav.openSettings').catch(() => undefined)
  }, [])

  /**
   * P3：点击回答里的 [ref:i]。引用编号只在渲染层内存映射到 docId，点击后走
   * 既有文档 docLink 打开链路（右栏详情 / flush 草稿 / 跨房间导航 / 目标选中），
   * 不另造一条写数据或导航的旁路。右栏编辑器未挂载时给出明确提示，不做假跳转。
   */
  const openRef = useCallback((ref: number) => {
    const hit = useAgentSessionStore.getState().references.find((item) => item.ref === ref)
    if (!hit) return
    void executeCommand('rightPanel.reveal', { tab: 'detail' }).catch(() => undefined)
    const handled = requestOpenDocumentLink({ docId: hit.docId, title: hit.title })
    if (!handled) {
      useAgentSessionStore.getState().appendAssistantNote(
        `引用 [ref:${ref}] 需要在右栏「详情」打开且画布已选中节点时才能跳转；请先在画布选中一个节点后重试。`,
      )
    }
  }, [])

  return (
    <div className={tmUI('flex min-h-0 flex-1 flex-col', chatFontClass)} data-tm-ai-agent-panel="">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border-light)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={1.8} />
          <span className="tm-label">AI Agent</span>
          <span className={TM_UI.badgeAccent}><Wrench className="mr-1 inline h-3 w-3" />工具 · 需确认</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="新建会话" aria-label="新建会话" onClick={newSession} className={TM_UI.iconButton}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" title="打开 AI 设置" aria-label="打开 AI 设置" onClick={openSettings} className={TM_UI.iconButton}>
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* P4-S：当前会话 + 历史入口。独立一条窄栏，不往已有 header 里挤第三个按钮。 */}
      <div
        className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-light)] px-2 py-1"
        data-tm-ai-session-bar=""
      >
        <button
          type="button"
          title="历史会话"
          aria-label="历史会话"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((value) => !value)}
          className={showHistory ? TM_UI.buttonActive : TM_UI.iconButton}
          data-tm-ai-session-toggle=""
        >
          <History className="h-4 w-4" />
        </button>
        <span
          className="tm-hint min-w-0 flex-1 truncate"
          title={activeTitle}
          data-tm-ai-session-current=""
        >
          {activeTitle}
        </span>
        <span className={TM_UI.badge} data-tm-ai-session-count="">{summaries.length}</span>
      </div>

      {showHistory && <SessionHistory />}

      <AgentSelector />

      <div ref={scrollRef} className="tm-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3" data-tm-ai-messages="">
        {messages.length === 0 ? (
          <EmptyState
            size="md"
            icon={<Sparkles className="h-6 w-6" strokeWidth={1.8} />}
            title="开始对话"
            description="AI 可调用只读工具检索工作区；写操作只会生成变更建议，需你预览确认后才会写入。"
          />
        ) : messages.map((message) => {
          const isUser = message.role === 'user'
          return (
            <div
              key={message.id}
              className={tmUI(
                BUBBLE_BASE,
                isUser
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-border-light)] bg-[var(--color-surface)]',
              )}
            >
              <div className="tm-hint mb-1">{isUser ? '你' : 'AI 助手'}</div>
              {isUser ? (
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
              ) : (
                <AiMarkdown
                  content={message.content}
                  placeholder={message.streaming ? '正在生成…' : undefined}
                  references={references}
                  onOpenRef={openRef}
                />
              )}
            </div>
          )
        })}

        {toolRounds.map((round) => (
          <details
            key={round.round}
            className="mb-3 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 py-2"
            data-tm-ai-tool-round={round.round}
          >
            <summary className={`${TM_UI.hint} cursor-pointer`}>
              第 {round.round + 1} 轮 · 调用 {round.calls.length} 个工具
            </summary>
            <ul className="mt-2 space-y-1">
              {round.calls.map((call) => (
                <li key={call.callId} className="text-xs text-[var(--color-text-secondary)]">
                  <span className={`${TM_UI.badge} mr-1`}>{call.toolId}</span>
                  <span>{call.kind === 'patch' ? '变更建议' : call.kind === 'error' ? '失败'
                    : call.kind === 'delegate' ? '子智能体委托' : '只读'}</span>
                  <div className="mt-1 break-words">{call.summary}</div>
                </li>
              ))}
            </ul>
          </details>
        ))}

        {delegations.map((record) => (
          <DelegationCard key={record.id} record={record} />
        ))}

        {pendingPlan && (
          <div
            className={`${TM_UI.scroll} max-h-64 shrink-0 overflow-y-auto rounded-lg border border-[var(--color-border-light)]`}
            data-tm-ai-patch-host=""
          >
            <PatchPreview
              plan={pendingPlan}
              selectedOpIds={selectedOpIds}
              onToggle={(opId) => useAgentSessionStore.getState().toggleOp(opId)}
              onApply={() => void applyPatch()}
              onReject={rejectPendingPatch}
              busy={applying}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="flex shrink-0 items-start gap-2 border-t border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
          <span className="tm-hint flex-1 break-words">{error.message}</span>
          <button type="button" title="关闭提示" aria-label="关闭提示" onClick={() => useAgentSessionStore.getState().clearError()} className={TM_UI.iconButton}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-[var(--color-border-light)] p-2">
        <textarea
          aria-label="向 AI 提问"
          data-tm-ai-composer=""
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={3}
          placeholder="输入问题…"
          className={tmUI(TM_UI.input, 'w-full resize-none', chatFontClass)}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="tm-hint">Enter 发送 · Shift + Enter 换行</span>
          {isStreaming ? (
            <button type="button" onClick={stop} className={TM_UI.button}>
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || Boolean(pendingPlan) || isStreaming}
              className={tmUI(TM_UI.buttonPrimary, 'disabled:opacity-50')}
            >
              <Send className="mr-1 inline h-3.5 w-3.5" />发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
