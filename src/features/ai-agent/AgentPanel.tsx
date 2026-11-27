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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, History, Plus, Settings2, Sparkles, Wrench, X } from 'lucide-react'
import { EmptyState } from '@/shared/ui/EmptyState'
import LeftDockCollapseButton from '@/features/layout/LeftDockCollapseButton'
import {
  requestOpenReference,
} from '@/features/documents/SmartDocumentEditor/docLinkBridge'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { executeCommand } from '@/application/commands'
import { cancelAiChat } from '@/core/ai-backend'
import type { AiChatAgentPayload, AiWireMessage } from '@/core/ai-types'
import AiMarkdown from './AiMarkdown'
import AgentComposer from './components/AgentComposer'
import AgentQuestionRail from './components/AgentQuestionRail'
import AgentSessionTabs from './components/AgentSessionTabs'
import AgentSelector from './components/AgentSelector'
import DelegationCard from './components/DelegationCard'
import PatchPreview from './components/PatchPreview'
import SessionHistory from './components/SessionHistory'
import type { ReasoningMode } from './config/agentTypes'
import { buildPromptValues } from './config/promptValues'
import { renderPrompt } from './config/renderPrompt'
import { ensureAiEventBridge } from './model/aiEventBridge'
import { useAgentComposerStore } from './model/agentComposerStore'
import { getActiveAgent, useAgentDefinitionStore } from './model/agentDefinitionStore'
import { useAgentPreferencesStore } from './model/agentPreferencesStore'
import { useAiModelStore } from './model/aiModelStore'
import { useAgentSessionListStore } from './model/agentSessionListStore'
import { useAgentSessionTabsStore } from './model/agentSessionTabsStore'
import { useAgentSettingsWindowStore } from './model/agentSettingsWindowStore'
import { useAgentSessionStore } from './model/agentSessionStore'
import { abortToolRun, applyPendingPatch, looksLikeUnfinishedPreamble, rejectPendingPatch, startToolRun } from './model/agentToolLoop'
import { useAgentToolRuntime } from './model/useAgentToolRuntime'
import { EMPTY_SELECTION_SNAPSHOT, buildSelectionEnvelope } from './model/aiSelectionSnapshot'
import { buildSelectionContentEnvelope } from './model/selectionContent'
import { useAiSelectionStore } from './model/aiSelectionStore'

const BUBBLE_BASE = 'rounded-lg border px-3 py-2'

// 流式事件只注册一条全局管道，不随组件挂载/卸载反复订阅（否则 token 会被重复追加）。
ensureAiEventBridge()

export default function AgentPanel() {
  const [draft, setDraft] = useState('')
  const [applying, setApplying] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  /** 提问轨道点刻度后短时高亮的目标消息；只是渲染层瞬时状态，不落盘。 */
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const messages = useAgentSessionStore((state) => state.messages)
  const status = useAgentSessionStore((state) => state.status)
  const error = useAgentSessionStore((state) => state.error)
  const toolRounds = useAgentSessionStore((state) => state.toolRounds)
  const delegations = useAgentSessionStore((state) => state.delegations)
  const references = useAgentSessionStore((state) => state.references)
  const pendingPlan = useAgentSessionStore((state) => state.pendingPlan)
  const selectedOpIds = useAgentSessionStore((state) => state.selectedOpIds)
  const fontSize = useAgentPreferencesStore((state) => state.fontSize)
  const settingsOpen = useAgentSettingsWindowStore((state) => state.open)
  const summaries = useAgentSessionListStore((state) => state.summaries)
  const activeSessionId = useAgentSessionListStore((state) => state.activeSessionId)
  const openSessionIds = useAgentSessionTabsStore((state) => state.openSessionIds)
  const { runtime, workspaceApi } = useAgentToolRuntime()
  const pendingDraft = useAgentComposerStore((state) => state.pendingDraft)
  // 「让 AI 修改」入口的一次性预填：只写输入框，不自动发送。
  // 这是跨模块的一次性交接信号（外部 store → 本地 draft），必须在本轮
  // effect 内同步消费掉，否则下一次同值信号会被误当成已处理。
  useEffect(() => {
    if (!pendingDraft) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(pendingDraft)
    useAgentComposerStore.getState().setPendingDraft(null)
  }, [pendingDraft])
  const isStreaming = status === 'streaming'
  const chatFontClass = fontSize === 'small'
    ? TM_UI.aiFontSmall
    : fontSize === 'large' ? TM_UI.aiFontLarge : TM_UI.aiFontMedium

  // P4-T：tab 栏只显示仍存在于当前工作区的会话；激活会话永远兜底占一个 tab，
  // 避免 listStore 与 tabsStore 订阅时序差一帧时出现「没有激活 tab」的空栏。
  const tabIds = useMemo(() => {
    const valid = openSessionIds.filter((id) => summaries.some((item) => item.id === id))
    if (!activeSessionId) return valid
    return valid.includes(activeSessionId) ? valid : [activeSessionId, ...valid]
  }, [openSessionIds, summaries, activeSessionId])

  const closeHistory = useCallback(() => setShowHistory(false), [])

  // P4-S：进入工作目录后恢复历史会话列表与上次打开的会话（幂等，多次挂载无副作用）。
  // 末尾补一次 ensureTab：tabsStore 的订阅可能比 ensureLoaded 晚建立，兜住首次进入。
  useEffect(() => {
    void useAgentSessionListStore.getState().ensureLoaded().then(() => {
      const id = useAgentSessionListStore.getState().activeSessionId
      if (id) useAgentSessionTabsStore.getState().ensureTab(id)
    })
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, pendingPlan, toolRounds, delegations])

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
  }, [])

  /** 提问轨道：把对应消息气泡平滑滚到可视区顶部，并短时描边提示落点。 */
  const jumpToQuestion = useCallback((id: string) => {
    const container = scrollRef.current
    if (!container) return
    const row = [...container.querySelectorAll<HTMLElement>('[data-tm-ai-message-id]')]
      .find((item) => item.getAttribute('data-tm-ai-message-id') === id)
    if (!row) return
    const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollTo({ top: Math.max(0, container.scrollTop + delta - 12), behavior: 'smooth' })
    setTargetMessageId(id)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => {
      setTargetMessageId((current) => (current === id ? null : current))
      flashTimerRef.current = null
    }, 1400)
  }, [])

  /** 实际发送一条文本。输入框清空由 AgentComposer 负责，快捷回复可复用本函数。 */
  const sendText = useCallback(async (raw: string) => {
    const text = raw.trim()
    // 有未处理的变更预览时不再发起新任务，避免两份 pendingPatch 互相覆盖。
    if (!text || useAgentSessionStore.getState().status === 'streaming' || pendingPlan) return
    // P4-S：首次发送前确保会话列表已载入，否则本次对话不会被挂到历史会话下。
    await useAgentSessionListStore.getState().ensureLoaded()
    const store = useAgentSessionStore.getState()
    if (store.status === 'streaming' || store.pendingPlan) return
    const prefs = useAgentPreferencesStore.getState()
    const initialAgent = getActiveAgent()
    const effectiveMode: ReasoningMode = prefs.reasoningMode ?? initialAgent?.model.reasoning.mode ?? 'auto'
    // 发问瞬间冻结选中快照：模型这一轮看到的 docId / nodeIds / blockIds 不会
    // 随用户中途点击漂移。信封只加在本轮外发的 user message 上，不写进会话正文，
    // 因此用户气泡里仍是自己敲的原文，历史也不会残留过期目标。
    const workspaceContext = runtime.getContext()
    const selection = workspaceContext.selection ?? EMPTY_SELECTION_SNAPSHOT
    const envelope = buildSelectionEnvelope(selection)
    // 历史里残留的「我先读取…：」是没有下文的空转声明，回灌给模型只会让它
    // 顺着再重复一遍；这类消息不是有效回答，组装 wire messages 时直接剔除。
    const history: AiWireMessage[] = store.messages
      .filter((item) => item.role !== 'assistant' || !looksLikeUnfinishedPreamble(item.content))
      .map((item) => ({ role: item.role, content: item.content }))
    store.addUserMessage(text, { agentId: initialAgent?.id, reasoningMode: effectiveMode })
    // 输入历史只记「用户发出过什么」，与会话正文落盘互不耦合；无 Key 降级时也成立。
    useAgentComposerStore.getState().pushInput(text)
    const baseTaskId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    try {
      // P5：按「对话临时选择 > Agent 绑定 > 全局默认」解析本轮唯一生效模型，
      // 只检查该模型自己的 Key（多模型下别的模型没配 Key 不应阻塞当前对话）。
      await useAiModelStore.getState().ensureLoaded()
      const activeModel = useAiModelStore.getState().resolveActive(initialAgent?.modelId ?? null)
      if (!activeModel?.hasKey) {
        useAgentSessionStore.getState().fail(
          'no_key',
          `尚未配置 API Key：模型「${activeModel?.name ?? '默认'}」还没有密钥，请到「AI 设置 → AI 助手」填写后再试`,
        )
        return
      }
      // S2：取当前 Agent → 渲染最终 prompt → 合并会话级深度思考覆盖，
      // 只把最终字符串与已钳制参数交给主进程，不传模板、不传密钥。
      await useAgentDefinitionStore.getState().ensureLoaded()
      const active = getActiveAgent()
      const chatAgent: AiChatAgentPayload | undefined = active ? {
        agentId: active.id,
        // 模型 id 随本轮快照下发；主进程按 id 取服务地址与密钥，不含任何敏感信息。
        modelId: activeModel.id,
        systemPrompt: renderPrompt(
          active.systemPrompt,
          buildPromptValues(active.toolIds, {
            selection,
            activeTabId: workspaceContext.activeTabId,
            roomPath: workspaceContext.roomPath,
          }),
          active.promptVars,
        ).prompt,
        model: active.model,
        reasoning: {
          mode: prefs.reasoningMode ?? active.model.reasoning.mode,
          protocol: prefs.reasoningProtocol ?? active.model.reasoning.protocol,
          effort: active.model.reasoning.effort,
        },
      } : undefined
      // 选中目标的当前内容随本轮一起外发：模型无需先调 document.read 就能作答，
      // 也不会因为网关没回传 tool_calls 而卡在一句「我先读取…：」上。
      // 读文档走与 document.read 同源的 runtime 端口，失败静默降级为空串。
      const contentEnvelope = envelope
        ? await buildSelectionContentEnvelope({
          selection,
          readDocument: (docId) => runtime.read.readDocument(docId),
        })
        : ''
      const outboundText = [text, envelope, contentEnvelope]
        .filter((part): part is string => Boolean(part))
        .join('\n\n')
      // P2：tools 快照由当前 Agent 的 toolIds 固定，一轮会话内不再变化。
      // 附加引用是一次性意图，已经冻结进本轮信封与 systemPrompt，发完即清。
      useAiSelectionStore.getState().clearPinned()
      await startToolRun({
        baseTaskId,
        messages: [...history, { role: 'user', content: outboundText }],
        agent: chatAgent,
        toolIds: active?.toolIds ?? [],
        runtime,
        modelId: activeModel.id,
      })
    } catch {
      abortToolRun()
      useAgentSessionStore.getState().fail('network', '无法连接 AI 网关，请稍后重试')
    }
  }, [pendingPlan, runtime])

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

  /** 点 tab = 换入该会话正文；activeSessionId 变化时 tabsStore 自动补位 / 高亮。 */
  const selectTab = useCallback((id: string) => {
    if (id === useAgentSessionListStore.getState().activeSessionId) return
    void useAgentSessionListStore.getState().switchSession(id)
  }, [])

  /** 关闭 tab：只摘掉入口，不删磁盘会话；关掉激活项时先切到相邻会话再摘。 */
  const closeTab = useCallback((id: string) => {
    const tabs = useAgentSessionTabsStore.getState()
    if (tabs.openSessionIds.length <= 1) return
    const active = useAgentSessionListStore.getState().activeSessionId
    if (id !== active) {
      tabs.removeTab(id)
      return
    }
    const next = tabs.openSessionIds.find((item) => item !== id)
    if (!next) return
    void useAgentSessionListStore.getState().switchSession(next).finally(() => {
      useAgentSessionTabsStore.getState().removeTab(id)
    })
  }, [])

  const applyPatch = useCallback(async () => {
    setApplying(true)
    try {
      await applyPendingPatch(workspaceApi)
    } finally {
      setApplying(false)
    }
  }, [workspaceApi])

  /** 设置按钮开的是画布页覆盖式 AI 设置窗口，不再跳到全局设置页（可边调边聊）。 */
  const toggleSettings = useCallback(() => {
    setShowHistory(false)
    useAgentSettingsWindowStore.getState().toggleWindow()
  }, [])

  /**
   * P3 / P5-r：点击回答里的 [ref:i]。引用编号只在渲染层内存映射到 docId。
   * 先把右栏切到「详情」，再走常驻的引用预览桥：只在右栏临时、只读地展示
   * 目标文档，**不**切换画布房间 / 知识库、**不**改动选中节点。这里绝不走
   * 编辑器内的双链桥 —— 那条链路属于「打开并定位到目标」，会联动整张画布。
   * 预览桥未能打开（文档已删 / 在回收站 / 右栏暂不可用）才给出明确提示。
   */
  const openRef = useCallback(async (ref: number) => {
    const hit = useAgentSessionStore.getState().references.find((item) => item.ref === ref)
    if (!hit) return
    try {
      await executeCommand('rightPanel.reveal', { tab: 'detail' })
    } catch {
      // reveal 失败不阻断引用桥：右栏可能本来就展开着。
    }
    const opened = await requestOpenReference({
      docId: hit.docId,
      title: hit.title,
      ref: hit.ref,
      breadcrumb: hit.breadcrumb,
      nodeName: hit.nodeName,
      blockLabel: hit.blockLabel,
      snippet: hit.snippet,
    })
    if (!opened) {
      useAgentSessionStore.getState().appendAssistantNote(
        `引用 [ref:${ref}] 未能预览「${hit.title}」：文档可能已删除、移入回收站，或右栏暂不可用。`,
      )
    }
  }, [])

  return (
    <div className={tmUI('flex min-h-0 flex-1 flex-col', chatFontClass)} data-tm-ai-agent-panel="">
      {/* P4-T：单行标题栏 = 历史入口（最左固定）+ 可横向滚动的会话 tab 栏（中段）
          + 新建 / 设置 / 折叠（最右固定）。历史列表改为挂在本行下方的浮窗，
          不再占用第二条文档流窄栏；240px 窄栏里中段 min-w-0 且自带横向滚动，
          右侧操作组永远不会被挤走。 */}
      <div
        className="relative flex h-9 shrink-0 items-center gap-1 border-b border-[var(--color-border-light)] px-1.5"
        data-tm-ai-session-header=""
      >
        <button
          ref={historyTriggerRef}
          type="button"
          title="历史会话记录"
          aria-label="历史会话记录"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((value) => !value)}
          className={tmUI(TM_UI.iconButton, 'relative')}
          data-tm-ai-session-toggle=""
        >
          <History className="h-4 w-4" />
          <span className={TM_UI.aiSessionCount} data-tm-ai-session-count="">{summaries.length}</span>
        </button>

        <AgentSessionTabs
          tabIds={tabIds}
          activeId={activeSessionId}
          summaries={summaries}
          onSelect={selectTab}
          onClose={closeTab}
        />

        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" title="新建会话" aria-label="新建会话" onClick={newSession} className={TM_UI.iconButton}>
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={settingsOpen ? '关闭 AI 设置' : '打开 AI 设置'}
            aria-label="打开 AI 设置"
            aria-pressed={settingsOpen}
            onClick={toggleSettings}
            className={TM_UI.iconButton}
            data-tm-ai-settings-toggle=""
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {/* 删掉外壳冗余标题行后，本行就是左栏的新标题栏：折叠入口固定在最右边。 */}
          <LeftDockCollapseButton />
        </div>

        {showHistory && <SessionHistory triggerRef={historyTriggerRef} onClose={closeHistory} />}
      </div>

      <AgentSelector />

      {/* 消息区宿主：滚动容器负责正文，提问轨道是它的兄弟覆盖层，不随正文滚动。
          左侧内边距取 --ai-question-rail-gutter，给细刻度让出 gutter 又不挤压气泡。 */}
      <div className="relative flex min-h-0 flex-1 flex-col" data-tm-ai-messages-host="">
        <div
          ref={scrollRef}
          className="tm-scroll min-h-0 flex-1 overflow-y-auto py-3 pr-3"
          style={{ paddingLeft: 'var(--ai-question-rail-gutter)' }}
          data-tm-ai-messages=""
        >
          {messages.length === 0 ? (
            <EmptyState
              size="md"
              icon={<Sparkles className="h-6 w-6" strokeWidth={1.8} />}
              title="开始对话"
              description="AI 可调用只读工具检索工作区；写操作只会生成变更建议，需你预览确认后才会写入。"
              action={
                <span className={TM_UI.badgeAccent}>
                  <Wrench className="mr-1 inline h-3 w-3" />工具 · 需确认
                </span>
              }
            />
          ) : messages.map((message) => {
            const isUser = message.role === 'user'
            // 成熟 Agent 的对话排版：用户气泡右对齐且限宽，AI 回复左对齐占满阅读宽度。
            // 角色由位置与配色区分，不再在气泡里重复写「你 / AI 助手」。
            return (
              <div
                key={message.id}
                className={tmUI('mb-3 flex', isUser ? 'justify-end' : 'justify-start')}
                data-tm-ai-message-row={isUser ? 'user' : 'assistant'}
                data-tm-ai-message-id={message.id}
                data-tm-ai-message-target={targetMessageId === message.id ? 'true' : undefined}
              >
                <div
                  className={tmUI(
                    BUBBLE_BASE,
                    'min-w-0',
                    isUser ? 'max-w-[85%]' : 'w-full',
                    isUser
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border-light)] bg-[var(--color-surface)]',
                  )}
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  ) : (
                    <AiMarkdown
                      content={message.content}
                      placeholder={message.streaming ? '正在生成…' : undefined}
                      references={references}
                      onOpenRef={(nextRef) => { void openRef(nextRef) }}
                    />
                  )}
                </div>
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

        <AgentQuestionRail messages={messages} scrollRef={scrollRef} onJump={jumpToQuestion} />
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

      <AgentComposer
        value={draft}
        onChange={setDraft}
        onSend={(text) => void sendText(text)}
        onStop={stop}
        streaming={isStreaming}
        blocked={Boolean(pendingPlan)}
        fontClass={chatFontClass}
      />
    </div>
  )
}
