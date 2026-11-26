/**
 * S3 委托卡片：一次 agent.delegate 的可复盘视图。
 *
 * 只消费内存里的 DelegationRecord，不落盘、不进日志（C10 / C15）；
 * systemPrompt 折叠展示，避免 240 窄栏被长提示词撑出横向滚动。
 */
import { TM_UI } from '@/shared/ui/controlStyles'
import type { DelegationRecord } from '../model/agentSessionStore'

interface DelegationCardProps {
  record: DelegationRecord
}

export default function DelegationCard({ record }: DelegationCardProps) {
  return (
    <div
      className="mb-3 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 py-2"
      data-tm-ai-delegation={record.id}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className={TM_UI.badgeAccent}>子智能体委托</span>
        <span className="tm-label break-words" data-tm-ai-delegation-agent="">
          {record.agentName || record.agentId}
        </span>
        <span className={record.ok ? TM_UI.badge : TM_UI.badgeDanger}>
          {record.ok ? '已完成' : '失败'}
        </span>
      </div>
      <div className="tm-hint mt-1 break-words" data-tm-ai-delegation-meta="">
        耗时 {record.elapsedMs}ms · 工具轮次 {record.rounds} · 只读工具 {record.toolIds.length} 项
        {record.code ? ` · ${record.code}` : ''}
      </div>
      <div className="tm-hint mt-1 break-words" data-tm-ai-delegation-task="">
        任务：{record.task}
      </div>
      <details className="mt-1">
        <summary className={`${TM_UI.hint} cursor-pointer`}>生效 system prompt</summary>
        <pre
          className="tm-hint mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words"
          data-tm-ai-delegation-prompt=""
        >{record.systemPrompt || '（未生成）'}</pre>
      </details>
      <div className="tm-hint mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words" data-tm-ai-delegation-summary="">
        结果摘要：{record.summary}
      </div>
    </div>
  )
}
