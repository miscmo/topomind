/**
 * 设置页「AI 助手」分区（P0）。
 *
 * 一期只支持用户自带 Key 的 OpenAI 兼容云端 API；providerType 的其它取值
 * 只在主进程预留，不在 UI 暴露。明文 Key 只从这里单向写入主进程，
 * 刷新页面拿到的永远只有 hasKey 布尔值。
 */
import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getAiConfig, saveAiConfig, testAiConnection } from '@/core/ai-backend'
import type { AiPublicConfig } from '@/core/ai-types'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { AI_CHAT_FONT_SIZE_OPTIONS, useAgentPreferencesStore } from '@/features/ai-agent/model/agentPreferencesStore'

const SECTION = 'mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5'
const ROW = 'flex flex-col gap-1 border-b border-[var(--color-border-light)] py-3 last:border-b-0'
const INPUT = 'w-full'

export default function AiSettingsSection() {
  const [config, setConfig] = useState<AiPublicConfig | null>(null)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const fontSize = useAgentPreferencesStore((state) => state.fontSize)
  const setFontSize = useAgentPreferencesStore((state) => state.setFontSize)

  // 异步读取主进程配置；cancelled 防止组件卸载后再 setState，
  // 也避免在 effect 主体里同步 setState（React 19 的级联渲染告警）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await getAiConfig()
        if (cancelled) return
        setConfig(next)
        setBaseURL(next.baseURL)
        setModel(next.model)
      } catch {
        if (cancelled) return
        setMessage('无法读取 AI 配置：需要在 Electron 桌面环境中运行')
        setIsError(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const report = useCallback((text: string, error = false) => {
    setMessage(text)
    setIsError(error)
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    try {
      const next = await saveAiConfig({
        baseURL,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setConfig(next)
      setApiKey('')
      setBaseURL(next.baseURL)
      setModel(next.model)
      report('配置已保存')
      return true
    } catch (error) {
      report(error instanceof Error ? error.message : '保存配置失败', true)
      return false
    } finally {
      setBusy(false)
    }
  }, [apiKey, baseURL, model, report])

  const test = useCallback(async () => {
    setBusy(true)
    try {
      const saved = await save()
      if (!saved) return
      const result = await testAiConnection()
      report(result.ok ? `连接成功 · ${result.model ?? ''}` : (result.message ?? '连接失败'), !result.ok)
    } catch {
      report('连接测试失败', true)
    } finally {
      setBusy(false)
    }
  }, [save, report])

  const clearKey = useCallback(async () => {
    setBusy(true)
    try {
      const next = await saveAiConfig({ clearKey: true })
      setConfig(next)
      setApiKey('')
      report('已清除 API Key')
    } catch {
      report('清除密钥失败', true)
    } finally {
      setBusy(false)
    }
  }, [report])

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

      <div className={ROW}>
        <label className="tm-label" htmlFor="ai-base-url">服务地址（OpenAI 兼容 /v1）</label>
        <input
          id="ai-base-url"
          type="text"
          spellCheck={false}
          value={baseURL}
          onChange={(event) => setBaseURL(event.target.value)}
          placeholder="https://api.openai.com/v1"
          className={tmUI(TM_UI.input, INPUT)}
        />
      </div>

      <div className={ROW}>
        <label className="tm-label" htmlFor="ai-model">模型名称</label>
        <input
          id="ai-model"
          type="text"
          spellCheck={false}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="gpt-4o-mini"
          className={tmUI(TM_UI.input, INPUT)}
        />
      </div>

      <div className={ROW}>
        <label className="tm-label" htmlFor="ai-api-key">API Key</label>
        <input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={config?.hasKey ? '已配置 · 留空表示保持不变' : '输入 API Key'}
          className={tmUI(TM_UI.input, INPUT)}
        />
        <span className="tm-hint">
          当前状态：{config?.hasKey ? '已配置' : '未配置'}
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

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <button type="button" disabled={busy} onClick={() => void save()} className={tmUI(TM_UI.buttonPrimary, 'disabled:opacity-50')}>保存</button>
        <button type="button" disabled={busy} onClick={() => void test()} className={tmUI(TM_UI.button, 'disabled:opacity-50')}>测试连接</button>
        <button type="button" disabled={busy || !config?.hasKey} onClick={() => void clearKey()} className={tmUI(TM_UI.button, 'disabled:opacity-50')}>清除密钥</button>
        {message && <span className={isError ? TM_UI.badgeDanger : TM_UI.badgeAccent}>{message}</span>}
      </div>

      <p className="tm-hint mt-3 leading-relaxed">
        隐私提示：提问时，当前会话中的对话内容会发送给你所配置的模型服务。后续版本会提供更精细的范围控制。
      </p>
    </div>
  )
}
