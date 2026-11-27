/**
 * 设置窗口「AI 助手」分区（P0；P5 升级为多模型）。
 *
 * 一个模型 = 显示名称 + 服务地址 + 模型名称 + 可选专属 API Key。列表支持
 * 新增 / 删除 / 编辑 / 设为全局默认；对话界面底部还能临时覆盖本次会话的模型。
 *
 * 兼容契约（GUI 冒烟按这些属性定位，勿动）：
 *  - 根 `data-tm-settings-ai`；输入 `#ai-base-url` / `#ai-model` / `#ai-api-key`；
 *  - 按钮文字「保存」「测试连接」「清除密钥」；保存必须把顶层 config.baseURL/model
 *    一并更新（主进程把默认模型镜像回顶层）；
 *  - 对话字号 / 工具轮次上限两块与文案「预览并确认后才会写入」。
 *
 * 明文 Key 只单向写入主进程，刷新拿到的永远只有每项的 hasKey 布尔值。
 */
import { useEffect, useState } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { testAiConnection } from '@/core/ai-backend'
import type { AiModelProfile, AiModelProfileInput } from '@/core/ai-types'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import {
  AI_CHAT_FONT_SIZE_OPTIONS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MAX_TOOL_ROUNDS_OPTIONS,
  useAgentPreferencesStore,
} from '@/features/ai-agent/model/agentPreferencesStore'
import {
  newModelDraft,
  toModelInput,
  useAiModelStore,
} from '@/features/ai-agent/model/aiModelStore'

const SECTION = 'mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5'
const ROW = 'flex flex-col gap-1 border-b border-[var(--color-border-light)] py-3 last:border-b-0'
const INPUT = 'w-full'

interface FormState {
  name: string
  baseURL: string
  model: string
  apiKey: string
}

const EMPTY_FORM: FormState = { name: '', baseURL: '', model: '', apiKey: '' }

function formFromProfile(profile: AiModelProfile): FormState {
  return { name: profile.name, baseURL: profile.baseURL, model: profile.model, apiKey: '' }
}

export default function AiSettingsSection() {
  const profiles = useAiModelStore((state) => state.profiles)
  const defaultModelId = useAiModelStore((state) => state.defaultModelId)
  const loaded = useAiModelStore((state) => state.loaded)
  const ensureLoaded = useAiModelStore((state) => state.ensureLoaded)
  const saveModels = useAiModelStore((state) => state.saveModels)
  const [selectedId, setSelectedId] = useState('')
  /** 只存用户改过的字段；当前模型的基准值一律从 store 派生，不需要 effect 同步 setState。 */
  const [formOverride, setFormOverride] = useState<Partial<FormState> | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const fontSize = useAgentPreferencesStore((state) => state.fontSize)
  const setFontSize = useAgentPreferencesStore((state) => state.setFontSize)
  const maxToolRounds = useAgentPreferencesStore((state) => state.maxToolRounds)
  const setMaxToolRounds = useAgentPreferencesStore((state) => state.setMaxToolRounds)

  // 工作区切换会 resetForWorkspace()，loaded 变 false 时自动重拉新目录的配置。
  useEffect(() => { if (!loaded) void ensureLoaded() }, [loaded, ensureLoaded])

  const report = (text: string, error = false) => {
    setMessage(text)
    setIsError(error)
  }

  const inputs: AiModelProfileInput[] = profiles.map(toModelInput)
  const selected = profiles.find((item) => item.id === selectedId) ?? null
  // selectedId 失效（首次载入 / 模型被删 / 换工作区）时自然回落到全局默认，
  // 不做任何 effect 里同步 setState，避免 React 19 级联渲染。
  const current = selected ?? profiles.find((item) => item.id === defaultModelId) ?? profiles[0] ?? null
  const defaultProfile = profiles.find((item) => item.id === defaultModelId) ?? profiles[0] ?? null
  const form: FormState = {
    ...(current ? formFromProfile(current) : EMPTY_FORM),
    ...(formOverride ?? {}),
  }
  // 首次挂载 / IPC 还没回来时也能保存：至少有一条可提交的默认模型。
  const resolvedDefaultId = defaultModelId || inputs[0]?.id || 'model.default'
  const targetId = selected ? selected.id : resolvedDefaultId
  const baseList = inputs.length > 0 ? inputs : [{ ...newModelDraft(null), id: resolvedDefaultId }]

  /** 把当前表单合并进待提交列表；模型名不能为空（主进程会回退成旧值，界面会骗人）。 */
  const merged = (): AiModelProfileInput[] | null => {
    if (!form.model.trim()) {
      report('模型名称不能为空', true)
      return null
    }
    return baseList.map((item) => (item.id === targetId
      ? {
        ...item,
        name: form.name.trim() || form.model.trim(),
        baseURL: form.baseURL.trim(),
        model: form.model.trim(),
      }
      : item))
  }

  const save = async (): Promise<boolean> => {
    const models = merged()
    if (!models) return false
    setBusy(true)
    const key = form.apiKey.trim()
    const saved = await saveModels(models, resolvedDefaultId, key
      ? (targetId === resolvedDefaultId ? { apiKey: key } : { modelKeys: { [targetId]: key } })
      : {})
    setBusy(false)
    if (!saved) {
      report(useAiModelStore.getState().error ?? '保存配置失败', true)
      return false
    }
    // 表单基准值来自 store，保存成功后清掉覆盖项即为「已保存的最新值」，Key 也一并清空。
    setFormOverride(null)
    report('配置已保存')
    return true
  }

  const test = async () => {
    setBusy(true)
    try {
      const saved = await save()
      if (!saved) return
      const result = await testAiConnection(selectedId)
      report(result.ok ? `连接成功 · ${result.model ?? ''}` : (result.message ?? '连接失败'), !result.ok)
    } catch {
      report('连接测试失败', true)
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    if (!current) return
    setBusy(true)
    const saved = await saveModels(baseList, resolvedDefaultId, {
      clearModelKeys: [current.id],
      // 默认模型用共享 Key；清掉它才真正让「未配置」状态生效，其它模型的专属 Key 保留。
      ...(current.id === resolvedDefaultId ? { clearKey: true } : {}),
    })
    setBusy(false)
    setFormOverride(null)
    report(saved ? '已清除该模型的 API Key' : '清除密钥失败', !saved)
  }

  const addModel = async () => {
    const draft = newModelDraft(defaultProfile)
    const saved = await saveModels([...baseList, draft], resolvedDefaultId)
    if (!saved) {
      report('新增模型失败', true)
      return
    }
    // 先落盘再选中：否则 store 尚未包含新 id，选中态会被上面的自动选择 effect 拉回默认。
    setSelectedId(draft.id)
    setFormOverride(null)
    report('已新增模型，可修改名称 / 服务地址 / 模型名称后点「保存」')
  }

  const removeModel = async (id: string) => {
    if (profiles.length <= 1) {
      report('至少保留一个模型', true)
      return
    }
    const next = baseList.filter((item) => item.id !== id)
    const nextDefault = id === resolvedDefaultId ? (next[0]?.id ?? '') : resolvedDefaultId
    const saved = await saveModels(next, nextDefault, { clearModelKeys: [id] })
    if (saved) setFormOverride(null)
    report(saved ? '已删除模型' : '删除模型失败', !saved)
  }

  const setDefault = async (id: string) => {
    const models = id === selectedId ? (merged() ?? baseList) : baseList
    const saved = await saveModels(models, id)
    if (saved) setFormOverride(null)
    report(saved ? '已设为全局默认模型' : '设置默认模型失败', !saved)
  }

  const selectModel = (profile: AiModelProfile) => {
    setSelectedId(profile.id)
    setFormOverride(null)
  }

  return (
    <div className={SECTION} data-tm-settings-ai="">
      <h2 className="mb-1 flex items-center gap-2 font-medium text-[var(--color-text-primary)]">
        <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />AI 助手
      </h2>
      <p className="tm-hint mb-4 leading-relaxed">
        使用你自己的模型服务与 API Key。密钥经系统安全存储加密后保存在本地工作目录，不会出现在日志中。
        AI 可调用只读工具检索工作区；写操作只生成变更建议，需你在对话面板预览并确认后才会写入，
        不会自动修改文档、节点或画布。
      </p>

      <div className={ROW} data-tm-ai-model-list-host="">
        <div className="flex items-center justify-between gap-2">
          <span className="tm-label">大模型列表 · {profiles.length}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void addModel()}
            className={tmUI(TM_UI.button, 'shrink-0 disabled:opacity-50')}
            data-tm-ai-model-add=""
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" />新增模型
          </button>
        </div>
        <div className="flex flex-col gap-1" data-tm-ai-model-list="">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              data-tm-ai-model-row={profile.id}
              className="flex min-w-0 items-center gap-2 rounded border border-[var(--color-border-light)] p-1.5"
            >
              <button
                type="button"
                title={`编辑模型：${profile.name}`}
                onClick={() => selectModel(profile)}
                className={tmUI(
                  profile.id === selectedId ? TM_UI.buttonActive : TM_UI.button,
                  'min-w-0 flex-1 text-left',
                )}
                data-tm-ai-model-select={profile.id}
              >
                <span className="block truncate">{profile.name}</span>
                <span className="tm-hint block truncate">{profile.model} · {profile.baseURL}</span>
              </button>
              {profile.id === resolvedDefaultId ? (
                <span className={tmUI(TM_UI.badgeAccent, 'shrink-0')}>全局默认</span>
              ) : (
                <button
                  type="button"
                  title={`把「${profile.name}」设为全局默认`}
                  disabled={busy}
                  onClick={() => void setDefault(profile.id)}
                  className={tmUI(TM_UI.button, 'shrink-0 disabled:opacity-50')}
                  data-tm-ai-model-default={profile.id}
                >
                  设为默认
                </button>
              )}
              <button
                type="button"
                title={`删除模型：${profile.name}`}
                aria-label={`删除模型：${profile.name}`}
                disabled={busy || profiles.length <= 1}
                onClick={() => void removeModel(profile.id)}
                className={tmUI(TM_UI.iconButton, 'shrink-0 disabled:opacity-50')}
                data-tm-ai-model-delete={profile.id}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <span className="tm-hint">
          全局默认：{defaultProfile?.name ?? '—'} · 对话界面底部可临时切换模型，Agent 也可单独绑定模型。
        </span>
      </div>

      <div className={ROW} data-tm-ai-model-form="">
        <span className="tm-label">编辑模型 · {current?.name ?? '未选择'}</span>
        <label className="tm-hint flex flex-col gap-1">
          显示名称
          <input
            id="ai-model-name"
            type="text"
            spellCheck={false}
            value={form.name}
            onChange={(event) => setFormOverride((prev) => ({ ...(prev ?? {}), name: event.target.value }))}
            placeholder="例如：DeepSeek V3"
            className={tmUI(TM_UI.input, INPUT)}
            data-tm-ai-model-name=""
          />
        </label>
        <label className="tm-label" htmlFor="ai-base-url">服务地址（OpenAI 兼容 /v1）</label>
        <input
          id="ai-base-url"
          type="text"
          spellCheck={false}
          value={form.baseURL}
          onChange={(event) => setFormOverride((prev) => ({ ...(prev ?? {}), baseURL: event.target.value }))}
          placeholder="https://api.openai.com/v1"
          className={tmUI(TM_UI.input, INPUT)}
        />
        <label className="tm-label" htmlFor="ai-model">模型名称</label>
        <input
          id="ai-model"
          type="text"
          spellCheck={false}
          value={form.model}
          onChange={(event) => setFormOverride((prev) => ({ ...(prev ?? {}), model: event.target.value }))}
          placeholder="gpt-4o-mini"
          className={tmUI(TM_UI.input, INPUT)}
        />
        <label className="tm-label" htmlFor="ai-api-key">API Key</label>
        <input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={form.apiKey}
          onChange={(event) => setFormOverride((prev) => ({ ...(prev ?? {}), apiKey: event.target.value }))}
          placeholder={current?.hasKey ? '已配置 · 留空表示保持不变' : '输入 API Key'}
          className={tmUI(TM_UI.input, INPUT)}
        />
        <span className="tm-hint">
          当前状态：{current?.hasKey ? '已配置' : '未配置'}
          {targetId === resolvedDefaultId ? ' · 默认模型使用共享 API Key' : ' · 留空则共用共享 API Key，也可填专属 Key'}
        </span>
      </div>

      <div className={ROW}>
        <span className="tm-label">对话字号</span>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="对话字号">
          {AI_CHAT_FONT_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={fontSize === option.value}
              title={option.hint}
              onClick={() => setFontSize(option.value)}
              className={fontSize === option.value ? TM_UI.buttonActive : TM_UI.button}
            >
              {option.label}
            </button>
          ))}
          <span className="tm-hint">立即生效 · 作用于 AI 回答与输入框</span>
        </div>
      </div>

      <div className={ROW}>
        <span className="tm-label">工具调用轮次上限</span>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="工具调用轮次上限"
          data-tm-ai-max-tool-rounds-group=""
        >
          {MAX_TOOL_ROUNDS_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={maxToolRounds === value}
              title={`一次提问最多连续调用 ${value} 轮工具`}
              onClick={() => setMaxToolRounds(value)}
              data-tm-ai-max-tool-rounds={value}
              className={maxToolRounds === value ? TM_UI.buttonActive : TM_UI.button}
            >
              {value} 轮
            </button>
          ))}
          <span className="tm-hint">默认 {DEFAULT_MAX_TOOL_ROUNDS} 轮 · 立即生效</span>
        </div>
        <span className="tm-hint">
          一次提问允许模型连续调用只读工具的轮数。达到上限后不再硬截断：AI 会基于已取得的结果继续作答；
          需要更长链路可调高，50 轮为防无限循环的安全阀。写工具一旦出现仍会停下来等你预览确认。
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <button type="button" disabled={busy} onClick={() => void save()} className={tmUI(TM_UI.buttonPrimary, 'disabled:opacity-50')} data-tm-ai-model-save="">保存</button>
        <button type="button" disabled={busy} onClick={() => void test()} className={tmUI(TM_UI.button, 'disabled:opacity-50')}>测试连接</button>
        <button type="button" disabled={busy || !current?.hasKey} onClick={() => void clearKey()} className={tmUI(TM_UI.button, 'disabled:opacity-50')}>清除密钥</button>
        {message && <span className={isError ? TM_UI.badgeDanger : TM_UI.badgeAccent}>{message}</span>}
      </div>

      <p className="tm-hint mt-3 leading-relaxed">
        隐私提示：提问时，当前会话中的对话内容会发送给你所配置的模型服务。后续版本会提供更精细的范围控制。
      </p>
    </div>
  )
}
