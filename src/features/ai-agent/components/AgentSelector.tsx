/**
 * 对话界面的智能体控件（S1-6）。
 *
 * 按 docs/design §15.7：深度思考三态的配置落点在**对话界面**而非设置页，
 * 只作用于本次会话（localStorage 偏好），不进主进程 config.json。
 * 「查看本次最终 prompt」是模型行为可观测的最小闭环：只读、不可编辑、不可导出。
 *
 * 窄栏（geometry.leftWidth 最小 240）下所有行都用 flex-wrap 降级，
 * 不新增占文档流的横条，视觉类一律取 TM_UI / controls.css。
 */
import { useEffect, useMemo, useState } from 'react'
import { Eye, RotateCcw } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import {
  REASONING_MODE_OPTIONS,
  REASONING_PROTOCOLS,
  REASONING_PROTOCOL_LABELS,
  type AgentDefinition,
  type ReasoningMode,
  type ReasoningProtocol,
} from '../config/agentTypes'
import { buildPromptValues } from '../config/promptValues'
import { renderPrompt, validatePromptTemplate } from '../config/renderPrompt'
import { TOOL_CATALOG } from '../config/toolCatalog'
import { useAgentDefinitionStore } from '../model/agentDefinitionStore'
import { useAgentPreferencesStore } from '../model/agentPreferencesStore'

interface PreviewProps {
  agent: AgentDefinition
  effectiveMode: ReasoningMode
  effectiveProtocol: ReasoningProtocol
}

function PromptPreview({ agent, effectiveMode, effectiveProtocol }: PreviewProps) {
  const rendered = useMemo(
    () => renderPrompt(agent.systemPrompt, buildPromptValues(agent.toolIds), agent.promptVars),
    [agent.systemPrompt, agent.promptVars, agent.toolIds],
  )
  const issue = useMemo(
    () => validatePromptTemplate(agent.systemPrompt, agent.promptVars),
    [agent.systemPrompt, agent.promptVars],
  )
  const m = agent.model
  return (
    <div className="mt-2 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-surface)] p-2" data-tm-ai-prompt-preview="">
      <div className="tm-label mb-1">本次会话生效参数（只读）</div>
      <div className="tm-hint mb-2 flex flex-wrap gap-x-3 gap-y-1">
        <span>Agent：{agent.name}</span>
        <span>model：{m.model ?? '继承全局'}</span>
        <span>temperature：{m.temperature ?? '继承全局'}</span>
        <span>top_p：{m.topP ?? '继承全局'}</span>
        <span>top_k：{m.topK ?? '不发送'}</span>
        <span>max_tokens：{m.maxTokens ?? '继承全局'}</span>
        <span>推理：{effectiveMode} / {REASONING_PROTOCOL_LABELS[effectiveProtocol]}</span>
        <span className="min-w-0 break-words">
          工具目录：{TOOL_CATALOG.length} 项 · 已接入 {TOOL_CATALOG.filter((item) => item.status === 'wired').length} 项
          {' '}· 本 Agent 开放 {agent.toolIds.filter((id) => TOOL_CATALOG.some((item) => item.id === id && item.status === 'wired')).length} 项
        </span>
      </div>
      <div className="tm-label mb-1">最终系统提示词</div>
      <div className="tm-hint max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border-light)] bg-[var(--color-bg)] p-2">
        {rendered.prompt || '（空）'}
      </div>
      {rendered.missingVars.length > 0 && (
        <div className="tm-hint mt-1">未提供变量：{rendered.missingVars.join('、')}（上下文信封接入后自动填充）</div>
      )}
      {!issue.ok && (
        <div className="tm-hint mt-1 text-[var(--color-danger)]">
          模板存在未声明变量或非法写法，请到「设置 → AI 智能体」修正
        </div>
      )}
      <div className="tm-hint mt-1">本视图只读，不提供编辑或导出；提示词正文不写入日志。</div>
    </div>
  )
}

export default function AgentSelector() {
  const [showPrompt, setShowPrompt] = useState(false)
  const config = useAgentDefinitionStore((state) => state.config)
  const activeAgentId = useAgentDefinitionStore((state) => state.activeAgentId)
  const setActiveAgent = useAgentDefinitionStore((state) => state.setActiveAgent)
  const ensureLoaded = useAgentDefinitionStore((state) => state.ensureLoaded)
  const reasoningOverride = useAgentPreferencesStore((state) => state.reasoningMode)
  const protocol = useAgentPreferencesStore((state) => state.reasoningProtocol)
  const setReasoningMode = useAgentPreferencesStore((state) => state.setReasoningMode)
  const setReasoningProtocol = useAgentPreferencesStore((state) => state.setReasoningProtocol)

  useEffect(() => { void ensureLoaded() }, [ensureLoaded])

  const agent = config?.agents.find((item) => item.id === activeAgentId)
    ?? config?.agents.find((item) => item.id === config.orchestratorId)
    ?? config?.agents[0]
  const effectiveMode: ReasoningMode = reasoningOverride ?? agent?.model.reasoning.mode ?? 'auto'

  return (
    <div className="shrink-0 border-b border-[var(--color-border-light)] px-2 py-1.5" data-tm-ai-agent-controls="">
      <div className="flex flex-wrap items-center gap-1">
        <select
          aria-label="选择智能体"
          value={activeAgentId ?? ''}
          onChange={(event) => setActiveAgent(event.target.value)}
          className={tmUI(TM_UI.select, 'min-w-0 flex-1')}
        >
          {!config && <option value="">加载中…</option>}
          {(config?.agents ?? []).filter((item) => item.enabled).map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind === 'orchestrator' ? '★ ' : ''}{item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="查看本次最终提示词"
          aria-label="查看本次最终提示词"
          aria-pressed={showPrompt}
          onClick={() => setShowPrompt((value) => !value)}
          className={showPrompt ? TM_UI.buttonActive : TM_UI.iconButton}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="tm-hint">深度思考</span>
        {REASONING_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            aria-pressed={effectiveMode === option.value && reasoningOverride === option.value}
            onClick={() => setReasoningMode(option.value)}
            className={effectiveMode === option.value ? TM_UI.buttonActive : TM_UI.button}
          >
            {option.label}
          </button>
        ))}
        {reasoningOverride !== null && (
          <button
            type="button"
            title="清除会话覆盖，恢复为该 Agent 的默认设置"
            onClick={() => setReasoningMode(null)}
            className={TM_UI.iconButton}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        {effectiveMode === 'on' && (
          <select
            aria-label="推理协议"
            value={protocol}
            onChange={(event) => setReasoningProtocol(event.target.value as ReasoningProtocol)}
            className={tmUI(TM_UI.select, 'min-w-0 max-w-full')}
          >
            {REASONING_PROTOCOLS.map((item) => (
              <option key={item} value={item}>{REASONING_PROTOCOL_LABELS[item]}</option>
            ))}
          </select>
        )}
      </div>

      {showPrompt && agent && (
        <PromptPreview agent={agent} effectiveMode={effectiveMode} effectiveProtocol={protocol} />
      )}
    </div>
  )
}
