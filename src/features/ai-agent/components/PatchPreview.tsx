/**
 * AgentPatch Diff 预览（P1 / B）。
 *
 * 受控组件：状态由调用方持有（P2 接入 tool calling 时由补丁会话驱动），
 * 本组件不自行发起任何写入，也不提供「自动应用」档位。
 * 只展示 dryRun 产出的 before / after、影响范围与风险等级，勾选后交给
 * commitAgentPatch —— 全仓唯一写执行点。
 *
 * 窄栏（leftWidth 最小 240）下逐行 flex-wrap；视觉类一律取 TM_UI / controls.css。
 */
import { useEffect } from 'react'
import { TM_UI } from '@/shared/ui/controlStyles'
import { recordUser } from '@/core/observe'
import type { PatchPlan, PatchPreviewItem, PatchRisk } from '../patch/agentPatchTypes'

export interface PatchPreviewProps {
  plan: PatchPlan
  selectedOpIds: string[]
  onToggle: (opId: string) => void
  onApply: () => void
  onReject: () => void
  busy?: boolean
}

const RISK_LABEL: Record<PatchRisk, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = JSON.stringify(value)
  if (text.length <= 160) return text
  return `${text.slice(0, 160)}…`
}

function riskBadge(risk: PatchRisk): string {
  if (risk === 'high') return TM_UI.badgeDanger
  if (risk === 'medium') return TM_UI.badgeWarning
  return TM_UI.badge
}

function PreviewItem({
  item, checked, onToggle,
}: {
  item: PatchPreviewItem
  checked: boolean
  onToggle: (opId: string) => void
}) {
  const disabled = item.status !== 'ready'
  return (
    <li
      className="rounded-lg border border-[var(--color-border-light)] bg-[var(--color-surface)] p-2"
      data-tm-ai-patch-item={item.opId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={() => onToggle(item.opId)}
          aria-label={`选择 ${item.summary}`}
        />
        <span className={`${TM_UI.badge} text-xs`}>{item.op}</span>
        <span className={`${riskBadge(item.risk)} text-xs`}>{RISK_LABEL[item.risk]}风险</span>
        <span className="text-xs text-[var(--color-text-secondary)]">影响 {item.affectedCount} 项</span>
      </div>
      <div className="mt-1 text-sm">{item.summary}</div>
      {disabled && (
        <div className={`${TM_UI.hint} mt-1 text-xs`}>
          不可提交：{item.blockedReason ?? 'blocked'}
        </div>
      )}
      <div className="mt-1 grid gap-1 text-xs text-[var(--color-text-secondary)]">
        <div>前：<code>{compact(item.before)}</code></div>
        <div>后：<code>{compact(item.after)}</code></div>
      </div>
    </li>
  )
}

export default function PatchPreview({
  plan, selectedOpIds, onToggle, onApply, onReject, busy = false,
}: PatchPreviewProps) {
  useEffect(() => {
    void recordUser('ai.patch_preview', {
      params: { taskId: plan.taskId, ready: plan.readyCount, blocked: plan.blockedCount },
      result: 'success',
      target: { type: 'app' },
    })
  }, [plan.taskId, plan.readyCount, plan.blockedCount])

  const reject = () => {
    void recordUser('ai.patch_reject', {
      params: { taskId: plan.taskId, applied: 0 },
      result: 'success',
      target: { type: 'app' },
    })
    onReject()
  }

  return (
    <section
      className="flex min-h-0 flex-col gap-2 p-2"
      aria-label="AI 变更预览"
      data-tm-ai-patch-preview=""
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={TM_UI.sectionHeader}>变更预览</span>
        <span className={`${TM_UI.badge} text-xs`}>
          可提交 {plan.readyCount} / 共 {plan.items.length}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          影响 {plan.totalAffected} 个对象
        </span>
      </div>

      {plan.warnings.length > 0 && (
        <ul className={`${TM_UI.hint} text-xs`}>
          {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <ul className={`${TM_UI.scroll} min-h-0 flex-1 space-y-2 overflow-y-auto`}>
        {plan.items.map((item) => (
          <PreviewItem
            key={item.opId}
            item={item}
            checked={selectedOpIds.includes(item.opId)}
            onToggle={onToggle}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={TM_UI.buttonPrimary}
          disabled={busy || selectedOpIds.length === 0}
          onClick={onApply}
        >
          应用所选
        </button>
        <button type="button" className={TM_UI.button} disabled={busy} onClick={reject}>
          放弃
        </button>
        <span className={`${TM_UI.hint} text-xs`}>应用后整次任务合并为一步撤销</span>
      </div>
    </section>
  )
}
