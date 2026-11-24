import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatDate } from '@/shared/observability/logFormatting'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import { LEVEL_COLORS } from '../constants'
import { useMonitorHost } from '../hostContext'

export function DetailPanel() {
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const [copied, setCopied] = useState(false)
  const resetCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { log } = useMonitorHost()

  useEffect(() => {
    return () => {
      if (resetCopiedTimerRef.current !== null) {
        clearTimeout(resetCopiedTimerRef.current)
      }
    }
  }, [])

  if (!selectedEntry) {
    return (
      <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] max-h-[280px] overflow-y-auto shrink-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-strong)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-text-muted)] [&::-webkit-scrollbar-thumb]:rounded-sm">
        <div className="p-6 text-[var(--color-text-muted)] text-[12px] text-center">选中一条日志查看详情</div>
      </div>
    )
  }

  // v2 error 是结构化对象；v1 读时兼容后可能是字符串。统一格式化成可复制文本。
  const errorText = typeof selectedEntry.error === 'string'
    ? selectedEntry.error
    : selectedEntry.error
      ? `${selectedEntry.error.name}: ${selectedEntry.error.message}${selectedEntry.error.stack ? `\n${selectedEntry.error.stack}` : ''}`
      : ''

  const handleCopy = () => {
    log.info('copy monitor log entry', { entryId: selectedEntry.id, entryLevel: selectedEntry.level })
    void navigator.clipboard.writeText(JSON.stringify(selectedEntry, null, 2)).then(() => {
      setCopied(true)
      if (resetCopiedTimerRef.current !== null) {
        clearTimeout(resetCopiedTimerRef.current)
      }
      resetCopiedTimerRef.current = setTimeout(() => {
        setCopied(false)
        resetCopiedTimerRef.current = null
      }, 2000)
    }).catch((error) => {
      log.error('copy monitor log entry failed', { entryId: selectedEntry.id, error: error instanceof Error ? error.message : String(error) })
    })
  }

  return (
    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] max-h-[280px] overflow-y-auto shrink-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-strong)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-text-muted)] [&::-webkit-scrollbar-thumb]:rounded-sm">
      <div className="flex items-center px-4 py-2 bg-[var(--color-bg-muted)] border-b border-[var(--color-border-subtle)] gap-2 sticky top-0 z-10">
        <span
          className="text-[11px] font-bold tracking-[0.5px]"
          style={{ color: LEVEL_COLORS[selectedEntry.level || 'INFO'] }}
        >
          {selectedEntry.level || 'INFO'}
        </span>
        <span className="flex-1 text-[12px] font-semibold text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
          {selectedEntry.action || selectedEntry.module || '日志条目'}
        </span>
        <div className="flex gap-1 shrink-0">
          <button className="h-6 px-2 border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[11px] cursor-pointer text-[var(--color-text-secondary)] transition-all duration-120 hover:bg-[var(--color-hover-bg)]" onClick={handleCopy}>
            {copied ? '已复制!' : '复制'}
          </button>
          <button className="h-6 px-2 border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[11px] cursor-pointer text-[var(--color-text-secondary)] transition-all duration-120 hover:bg-[var(--color-hover-bg)]" onClick={() => {
            log.info('close monitor detail entry', { closedEntryId: selectedEntry.id })
            setSelectedEntry(null)
          }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="p-3 px-4 flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">时间</span>
          <span className="text-[12px] text-[var(--color-text-primary)] break-all">{formatDate(selectedEntry.timestamp || '')}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">ID</span>
          <span className="text-[12px] text-[var(--color-text-primary)] break-all" style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {selectedEntry.id || '—'}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">模块</span>
          <span className="text-[12px] text-[var(--color-text-primary)] break-all">{selectedEntry.module || '—'}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">动作</span>
          <span className="text-[12px] text-[var(--color-text-primary)] break-all">{selectedEntry.action || '—'}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">消息</span>
          <span className="text-[12px] text-[var(--color-text-primary)] break-all">{selectedEntry.message || '—'}</span>
        </div>
        {errorText && (
          <div className="flex items-start gap-3 mt-1" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">异常</span>
            <pre className="mt-1 p-2 bg-[var(--color-danger-soft)] rounded-md font-mono text-[11px] text-[var(--color-danger)] leading-[1.6] overflow-x-auto whitespace-pre w-full border border-[var(--color-danger-soft)]">
              {errorText}
            </pre>
          </div>
        )}
        {selectedEntry.params && (
          <div className="flex items-start gap-3" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">参数</span>
            <pre className="mt-1 p-2 bg-[var(--color-bg-muted)] rounded-md font-mono text-[11px] text-[var(--color-text-secondary)] leading-[1.6] overflow-x-auto whitespace-pre w-full border border-[var(--color-border-subtle)]">
              {typeof selectedEntry.params === 'string'
                ? selectedEntry.params
                : JSON.stringify(selectedEntry.params, null, 2)}
            </pre>
          </div>
        )}
        {/* v3 关联键：一次操作靠 session/trace/span/seq 串起来，缺失字段读时兼容后仍可显示 */}
        <div className="flex items-start gap-3" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="w-[50px] min-w-[50px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0" style={{ fontSize: 'var(--font-size-sm)' }}>关联</span>

          <pre className="mt-1 p-2 bg-[var(--color-bg-muted)] rounded-md font-mono leading-[1.6] overflow-x-auto whitespace-pre-wrap w-full border border-[var(--color-border-subtle)]" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {[
              `category=${selectedEntry.category || 'internal'}  label=${selectedEntry.label || '—'}`,
              `session=${selectedEntry.sessionId || '—'}  seq=${selectedEntry.seq ?? '—'}  workspace=${selectedEntry.workspaceId || '—'}`,
              `trace=${selectedEntry.traceId || '—'}`,
              `span=${selectedEntry.spanId || '—'}  parent=${selectedEntry.parentId || '—'}`,
              ...(selectedEntry.target ? [`target=${JSON.stringify(selectedEntry.target)}`] : []),
              ...(selectedEntry.result ? [`result=${selectedEntry.result}`] : []),
              ...(typeof selectedEntry.durationMs === 'number' ? [`durationMs=${selectedEntry.durationMs}`] : []),
              ...(selectedEntry.source || selectedEntry.outcome ? [`source=${selectedEntry.source || '—'}  outcome=${selectedEntry.outcome || '—'}`] : []),
              ...(selectedEntry.kind ? [`kind=${selectedEntry.kind}`] : []),
              ...(typeof selectedEntry.stepCount === 'number'
                ? [`stepCount=${selectedEntry.stepCount}（P7 过程步骤留内存，仅异常 / 诊断包 dump）`] : []),
              ...(selectedEntry.steps?.length
                ? [`steps=${selectedEntry.steps.length} 条：${selectedEntry.steps.slice(0, 8).map((step) => `${step.name}${step.outcome ? `/${step.outcome}` : ''}`).join(' → ')}${selectedEntry.steps.length > 8 ? ' …' : ''}`]
                : []),
              ...(typeof selectedEntry.repeatCount === 'number'
                ? [`repeatCount=${selectedEntry.repeatCount}（同一事实被去重合并的次数）`] : []),
              ...(selectedEntry.fingerprint ? [`fingerprint=${selectedEntry.fingerprint}`] : []),
              ...(selectedEntry.breadcrumbs?.length ? [`breadcrumbs=${selectedEntry.breadcrumbs.length} 条（D2 仅随 error 同步落盘）`] : []),
              ...(selectedEntry.dumpRef ? [`dumpRef=${selectedEntry.dumpRef.available ? `${selectedEntry.dumpRef.dir}/${selectedEntry.dumpRef.file ?? '—'}` : 'unavailable'}`] : []),
              ...(selectedEntry.env ? [`env=${selectedEntry.env.platform}/${selectedEntry.env.arch} electron=${selectedEntry.env.electron ?? '—'} app=${selectedEntry.env.appVersion ?? '—'}`] : []),
            ].join('\n')}
          </pre>
        </div>
        {selectedEntry.meta && (
          <div className="flex items-start gap-3" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.5px] pt-[1px] shrink-0">元数据</span>
            <pre className="mt-1 p-2 bg-[var(--color-bg-muted)] rounded-md font-mono text-[11px] text-[var(--color-text-secondary)] leading-[1.6] overflow-x-auto whitespace-pre w-full border border-[var(--color-border-subtle)]">
              {JSON.stringify(selectedEntry.meta, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
