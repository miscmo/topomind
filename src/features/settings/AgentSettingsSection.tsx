/**
 * 设置页「AI 智能体」分区（S1-5）。
 *
 * 参考火山引擎智能体模板页做减法（docs/design §15.8）：
 *  - 内置模板卡片 →「使用模板」深拷贝成用户 Agent；
 *  - Agent 表单编辑系统提示词、模板变量、模型参数、工具白名单；
 *  - 工具目录**只读**：无添加 / 删除 / 编辑 / 启停 / 测试按钮（决策 6）；
 *  - 「技能 / MCP」当前不存在，置灰标注后续支持，不做可点的假入口；
 *  - 不提供任何导入导出入口（决策 7）。
 *
 * 视觉类一律取 TM_UI / controls.css，布局类内联；不写字面色值与 z-index。
 */
import { useEffect, useMemo, useState } from 'react'
import { Bot, Plus, Trash2 } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import {
  AGENT_LIMITS,
  PROMPT_VAR_IDS,
  PROMPT_VAR_LABELS,
  REASONING_MODE_OPTIONS,
  REASONING_PROTOCOLS,
  REASONING_PROTOCOL_LABELS,
  type AgentDefinition,
  type PromptVarId,
  type ReasoningEffort,
  type ReasoningMode,
  type ReasoningProtocol,
} from '@/features/ai-agent/config/agentTypes'
import { BUILTIN_AGENT_TEMPLATES } from '@/features/ai-agent/config/agentTemplates'
import { buildPromptValues } from '@/features/ai-agent/config/promptValues'
import { renderPrompt, validatePromptTemplate } from '@/features/ai-agent/config/renderPrompt'
import { TOOL_CATALOG, isAssignableToolId } from '@/features/ai-agent/config/toolCatalog'
import { useAgentDefinitionStore } from '@/features/ai-agent/model/agentDefinitionStore'

const SECTION = 'mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5'
const ROW = 'flex flex-col gap-1 border-b border-[var(--color-border-light)] py-3 last:border-b-0'
const INPUT = 'w-full'

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    promptVars: [...agent.promptVars],
    toolIds: [...agent.toolIds],
    tags: [...(agent.tags ?? [])],
    model: { ...agent.model, reasoning: { ...agent.model.reasoning } },
  }
}

interface NumberFieldProps {
  label: string
  value: number | undefined
  min: number
  max: number
  step: number
  onChange: (value: number | undefined) => void
}

function NumberField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="tm-hint">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder="继承全局"
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
        className={tmUI(TM_UI.input, INPUT)}
      />
    </label>
  )
}

interface FormProps {
  draft: AgentDefinition
  onChange: (next: AgentDefinition) => void
  onSave: () => void
  onDelete: () => void
  busy: boolean
}

function AgentForm({ draft, onChange, onSave, onDelete, busy }: FormProps) {
  const patch = (part: Partial<AgentDefinition>) => onChange({ ...draft, ...part })
  const patchModel = (part: Partial<AgentDefinition['model']>) => onChange({
    ...draft, model: { ...draft.model, ...part },
  })
  const patchReasoning = (part: Partial<AgentDefinition['model']['reasoning']>) => onChange({
    ...draft,
    model: { ...draft.model, reasoning: { ...draft.model.reasoning, ...part } },
  })
  const issue = validatePromptTemplate(draft.systemPrompt, draft.promptVars)

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border-light)] p-3" data-tm-ai-agent-form="">
      <div className={ROW}>
        <label className="tm-label" htmlFor="agent-name">名称</label>
        <input
          id="agent-name" type="text" value={draft.name}
          onChange={(event) => patch({ name: event.target.value.slice(0, AGENT_LIMITS.nameMax) })}
          className={tmUI(TM_UI.input, INPUT)}
        />
      </div>
      <div className={ROW}>
        <label className="tm-label" htmlFor="agent-desc">描述</label>
        <input
          id="agent-desc" type="text" value={draft.description}
          onChange={(event) => patch({ description: event.target.value.slice(0, AGENT_LIMITS.descriptionMax) })}
          className={tmUI(TM_UI.input, INPUT)}
        />
      </div>
      <div className={ROW}>
        <span className="tm-label">类型</span>
        <span className="tm-hint">
          {draft.kind === 'orchestrator' ? '总调度 Agent（全局唯一，不可改类型 / 不可删除）' : '子 Agent'}
        </span>
      </div>
      <div className={ROW}>
        <label className="tm-label" htmlFor="agent-prompt">系统提示词（支持 {'{{var}}'} 白名单变量）</label>
        <textarea
          id="agent-prompt" rows={7} spellCheck={false}
          value={draft.systemPrompt}
          onChange={(event) => patch({ systemPrompt: event.target.value.slice(0, AGENT_LIMITS.systemPromptMax) })}
          className={tmUI(TM_UI.input, INPUT, 'resize-y font-mono')}
        />
        <span className="tm-hint">
          {draft.systemPrompt.length} / {AGENT_LIMITS.systemPromptMax} 字
          {!issue.ok && ' · 存在未声明变量或非法写法，请检查变量勾选'}
        </span>
      </div>
      <div className={ROW}>
        <span className="tm-label">模板变量（勾选后才允许在提示词中出现）</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1" data-tm-agent-prompt-vars="">
          {PROMPT_VAR_IDS.map((id) => (
            <label key={id} className="tm-hint flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.promptVars.includes(id)}
                onChange={(event) => patch({
                  promptVars: event.target.checked
                    ? [...draft.promptVars, id as PromptVarId]
                    : draft.promptVars.filter((item) => item !== id),
                })}
              />
              {PROMPT_VAR_LABELS[id as PromptVarId]}
            </label>
          ))}
        </div>
      </div>
      <div className={ROW}>
        <span className="tm-label">模型参数（留空 = 继承全局 config.json）</span>
        <label className="tm-hint flex flex-col gap-1">
          模型名称
          <input
            type="text" value={draft.model.model ?? ''} placeholder="继承全局"
            onChange={(event) => patchModel({ model: event.target.value || undefined })}
            className={tmUI(TM_UI.input, INPUT)}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <NumberField label="temperature" value={draft.model.temperature} min={0} max={2} step={0.1}
            onChange={(value) => patchModel({ temperature: value })} />
          <NumberField label="top_p" value={draft.model.topP} min={0} max={1} step={0.05}
            onChange={(value) => patchModel({ topP: value })} />
          <NumberField label="top_k（仅部分供应商）" value={draft.model.topK} min={1} max={1000} step={1}
            onChange={(value) => patchModel({ topK: value })} />
          <NumberField label="max_tokens" value={draft.model.maxTokens} min={1} max={32768} step={256}
            onChange={(value) => patchModel({ maxTokens: value })} />
          <NumberField label="presence_penalty" value={draft.model.presencePenalty} min={-2} max={2} step={0.1}
            onChange={(value) => patchModel({ presencePenalty: value })} />
        </div>
      </div>
      <div className={ROW}>
        <span className="tm-label">深度思考（Agent 默认值；对话界面可临时覆盖）</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="默认推理模式" value={draft.model.reasoning.mode}
            onChange={(event) => patchReasoning({ mode: event.target.value as ReasoningMode })}
            className={TM_UI.select}
          >
            {REASONING_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="推理协议" value={draft.model.reasoning.protocol}
            onChange={(event) => patchReasoning({ protocol: event.target.value as ReasoningProtocol })}
            className={TM_UI.select}
          >
            {REASONING_PROTOCOLS.map((item) => (
              <option key={item} value={item}>{REASONING_PROTOCOL_LABELS[item]}</option>
            ))}
          </select>
          <select
            aria-label="推理强度" value={draft.model.reasoning.effort ?? ''}
            onChange={(event) => patchReasoning({ effort: (event.target.value || undefined) as ReasoningEffort | undefined })}
            className={TM_UI.select}
          >
            <option value="">自动</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <span className="tm-hint">top_k 与深度思考字段由主进程能力位协商，非 OpenAI 标准字段不会无条件透传。</span>
      </div>
      <div className={ROW}>
        <span className="tm-label">可调用工具白名单（只读目录，写工具仅生成需人工确认的变更建议）</span>
        <details data-tm-agent-tool-ids="">
          <summary className="tm-hint cursor-pointer">展开 {TOOL_CATALOG.filter((item) => item.permission !== 'never').length} 项可分配工具</summary>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {TOOL_CATALOG.filter((item) => item.permission !== 'never').map((item) => (
              <label key={item.id} className="tm-hint flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.toolIds.includes(item.id)}
                  onChange={(event) => patch({
                    toolIds: event.target.checked
                      ? [...draft.toolIds, item.id]
                      : draft.toolIds.filter((id) => id !== item.id),
                  })}
                />
                {item.id}
              </label>
            ))}
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <button type="button" disabled={busy || !issue.ok} onClick={onSave}
          className={tmUI(TM_UI.buttonPrimary, 'disabled:opacity-50')}>保存该智能体</button>
        {draft.kind !== 'orchestrator' && (
          <button type="button" disabled={busy} onClick={onDelete}
            className={tmUI(TM_UI.button, 'disabled:opacity-50')}>
            <Trash2 className="mr-1 inline h-3.5 w-3.5" />删除
          </button>
        )}
      </div>
    </div>
  )
}

function ToolCatalogTable() {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="tm-hint">
            <th className="py-1 pr-2">工具 id</th>
            <th className="py-1 pr-2">类别</th>
            <th className="py-1 pr-2">权限档</th>
            <th className="py-1 pr-2">输入</th>
            <th className="py-1 pr-2">状态</th>
          </tr>
        </thead>
        <tbody>
          {TOOL_CATALOG.map((item) => {
            const disabled = item.permission === 'never'
            const statusText = item.status === 'never' ? '永不开放'
              : item.status === 'wired' ? '已接入' : '未接入'
            return (
              <tr key={item.id} data-tm-tool-id={item.id} data-tm-tool-status={statusText}
                className={disabled ? 'tm-hint opacity-50' : 'tm-hint'}>
                <td className="py-1 pr-2 font-mono">{item.id}</td>
                <td className="py-1 pr-2">{item.kind === 'read' ? '读' : '写'}</td>
                <td className="py-1 pr-2">{item.permission}</td>
                <td className="py-1 pr-2">{item.params.map((param) => param.name).join(', ') || '—'}</td>
                <td className="py-1 pr-2">{statusText}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="tm-hint mt-2">
        目录为编译期静态数据，运行时不可增删改；已接入项由工具注册表下发给模型，
        写工具只生成变更建议，需你在对话面板预览确认后才会写入。
      </p>
    </div>
  )
}

export default function AgentSettingsSection() {
  const config = useAgentDefinitionStore((state) => state.config)
  const loading = useAgentDefinitionStore((state) => state.loading)
  const error = useAgentDefinitionStore((state) => state.error)
  const ensureLoaded = useAgentDefinitionStore((state) => state.ensureLoaded)
  const save = useAgentDefinitionStore((state) => state.save)
  const upsert = useAgentDefinitionStore((state) => state.upsert)
  const remove = useAgentDefinitionStore((state) => state.remove)
  const createFromTemplate = useAgentDefinitionStore((state) => state.createFromTemplate)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDefinition | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => { void ensureLoaded() }, [ensureLoaded])

  // 当前编辑对象用派生值，不在 effect 里同步 setState（React 19 级联渲染告警）。
  const effectiveId = selectedId ?? config?.orchestratorId ?? null
  const shownAgent = draft ?? (config?.agents.find((item) => item.id === effectiveId) ?? null)

  const preview = useMemo(() => {
    if (!shownAgent) return null
    return renderPrompt(shownAgent.systemPrompt, buildPromptValues(shownAgent.toolIds), shownAgent.promptVars)
  }, [shownAgent])

  const report = (text: string) => setMessage(text)

  const applyTemplate = async (templateId: string) => {
    setBusy(true)
    const id = await createFromTemplate(templateId)
    setBusy(false)
    if (!id) { report('使用模板失败'); return }
    setDraft(null)
    setSelectedId(id)
    report('已从模板创建智能体，可直接编辑后保存')
  }

  const createBlank = () => {
    if (!config) return
    const id = `agent.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
    const blank: AgentDefinition = {
      schema: 'topomind.agent-definition', version: 1, id,
      name: '新智能体', description: '', kind: 'sub',
      systemPrompt: '你是 TopoMind 的助手，请使用简体中文回答。',
      promptVars: [], model: { reasoning: { mode: 'auto', protocol: 'auto' } },
      toolIds: [], enabled: true, origin: 'user', tags: [],
    }
    setDraft(blank)
    setSelectedId(id)
    report('已新建草稿，编辑后点「保存该智能体」')
  }

  const saveDraft = async () => {
    if (!shownAgent) return
    if (!shownAgent.name.trim()) { report('名称不能为空'); return }
    if (shownAgent.systemPrompt.length > AGENT_LIMITS.systemPromptMax) { report('系统提示词过长'); return }
    const issue = validatePromptTemplate(shownAgent.systemPrompt, shownAgent.promptVars)
    if (!issue.ok) { report('提示词含未声明变量或非法写法'); return }
    setBusy(true)
    const ok = await upsert({ ...shownAgent, toolIds: shownAgent.toolIds.filter(isAssignableToolId) })
    setBusy(false)
    report(ok ? '已保存' : (useAgentDefinitionStore.getState().error ?? '保存失败'))
  }

  const deleteSelected = async () => {
    if (!shownAgent || shownAgent.kind === 'orchestrator') return
    if (typeof window !== 'undefined' && !window.confirm(`确定删除「${shownAgent.name}」？`)) return
    setBusy(true)
    const ok = await remove(shownAgent.id)
    setBusy(false)
    if (ok) { setDraft(null); setSelectedId(null); report('已删除') }
    else report('删除失败')
  }

  /** S3：allowedSubAgentIds 是 agent.delegate 的唯一白名单，主进程 normalize 会二次校验。 */
  const toggleDelegateAllowed = (id: string) => {
    if (!config) return
    const next = config.allowedSubAgentIds.includes(id)
      ? config.allowedSubAgentIds.filter((item) => item !== id)
      : [...config.allowedSubAgentIds, id]
    void save({ ...config, allowedSubAgentIds: next })
      .then((ok) => report(ok ? '自动调度白名单已更新' : '白名单保存失败'))
  }

  return (
    <div className={SECTION} data-tm-settings-ai-agents="">
      <h2 className="mb-1 flex items-center gap-2 font-medium text-[var(--color-text-primary)]">
        <Bot className="h-4 w-4 text-[var(--color-accent)]" />AI 智能体
      </h2>
      <p className="tm-hint mb-4 leading-relaxed">
        用模板创建自定义智能体，每个 Agent 独立配置系统提示词、模板变量与模型参数。
        连接地址与 API Key 仍全局统一配置，不支持为单个 Agent 单独设置。
      </p>

      <div className="tm-label">内置模板</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {BUILTIN_AGENT_TEMPLATES.map((template) => (
          <div key={template.templateId} className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-light)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="tm-label">{template.name}</span>
              <button type="button" disabled={busy} onClick={() => void applyTemplate(template.templateId)}
                className={tmUI(TM_UI.button, 'disabled:opacity-50')}>使用模板</button>
            </div>
            <p className="tm-hint mt-1 leading-relaxed">{template.description}</p>
            <div className="tm-hint mt-2 flex flex-wrap gap-1">
              {template.tags.map((tag) => <span key={tag} className={TM_UI.badge}>{tag}</span>)}
              <span className={TM_UI.badge}>工具 {template.toolIds.length}</span>
              <span className={TM_UI.badge}>变量 {template.promptVars.length}</span>
            </div>
            <p className="tm-hint mt-2 break-words">System prompt：{template.systemPrompt.slice(0, 80)}…</p>
          </div>
        ))}
      </div>
      <div className="tm-hint mt-2 flex flex-wrap items-center gap-2">
        <span className={TM_UI.badge}>技能（后续支持）</span>
        <span className={TM_UI.badge}>MCP（后续支持）</span>
        <span className={TM_UI.badge}>导入 / 导出（暂不支持）</span>
        <span>当前仅支持从随包模板创建或空白新建。</span>
      </div>

      <div className="tm-label mt-4">已配置的智能体</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(config?.agents ?? []).map((agent) => (
          <button
            key={agent.id} type="button"
            onClick={() => { setDraft(cloneAgent(agent)); setSelectedId(agent.id); setMessage('') }}
            className={agent.id === effectiveId ? TM_UI.buttonActive : TM_UI.button}
          >
            {agent.kind === 'orchestrator' ? '★ ' : ''}{agent.name}
          </button>
        ))}
        <button type="button" onClick={createBlank} className={TM_UI.button}>
          <Plus className="mr-1 inline h-3.5 w-3.5" />空白新建
        </button>
      </div>

      {shownAgent && (
        <AgentForm
          draft={shownAgent} onChange={setDraft}
          onSave={() => void saveDraft()} onDelete={() => void deleteSelected()} busy={busy || loading}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setShowPreview((value) => !value)} className={TM_UI.button}>
          {showPreview ? '收起最终提示词' : '预览最终提示词'}
        </button>
        {message && <span className={TM_UI.badgeAccent}>{message}</span>}
        {error && <span className={TM_UI.badgeDanger}>{error}</span>}
      </div>
      {showPreview && preview && (
        <div className="tm-hint mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border-light)] p-2">
          {preview.prompt}
          {preview.missingVars.length > 0 && `\n\n[未提供变量：${preview.missingVars.join('、')}]`}
        </div>
      )}

      <div className="tm-label mt-4">自动调度白名单（S3）</div>
      <p className="tm-hint mt-1 leading-relaxed">
        只有勾选的子 Agent 能被总调度 Agent 通过 agent.delegate 委托；子调用使用各自的
        系统提示词 / 模型参数与只读工具子集，结果回灌主会话，不会自动写入数据。
      </p>
      <div className="mt-2 flex flex-wrap gap-2" data-tm-agent-delegate-allowlist="">
        {(config?.agents ?? []).filter((agent) => agent.kind !== 'orchestrator').map((agent) => (
          <label
            key={agent.id}
            className="tm-hint flex items-center gap-1"
            data-tm-agent-delegate-option={agent.id}
          >
            <input
              type="checkbox"
              disabled={busy}
              checked={config?.allowedSubAgentIds.includes(agent.id) ?? false}
              onChange={() => toggleDelegateAllowed(agent.id)}
            />
            {agent.name}
          </label>
        ))}
        {!(config?.agents ?? []).some((agent) => agent.kind !== 'orchestrator') && (
          <span className="tm-hint">尚无子 Agent，先用模板创建一个。</span>
        )}
      </div>

      <details className="mt-4">
        <summary className="tm-label cursor-pointer">
          可调用工具列表（只读 · {TOOL_CATALOG.length} 项 · 已接入 {TOOL_CATALOG.filter((item) => item.status === 'wired').length} 项）
        </summary>
        <ToolCatalogTable />
      </details>
    </div>
  )
}
