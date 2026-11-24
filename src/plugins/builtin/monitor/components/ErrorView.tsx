import { useMemo, useState } from 'react'
import { AlertTriangle, Package, ShieldAlert } from 'lucide-react'
import { useMonitorStore, type LogEntry } from '@/plugins/public/monitorStore'
import {
  findRecoveryReports,
  flattenBreadcrumbs,
  groupErrorsByFingerprint,
  sortByTime,
} from '@/shared/observability/logViewModel'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useMonitorHost } from '../hostContext'
import { downloadDiagnosticBundle } from '../utils/bundleExport'

/**
 * v3 P4「异常与崩溃」：按 fingerprint 聚合、恢复报告、breadcrumbs 时间线、
 * dumpRef / env 与一键诊断包。P3 已把四个 error 专属字段落盘，这里只做呈现。
 */
const TM_UI = {
  group: 'tm-error-group flex items-center gap-2 px-3 py-2 w-full text-left border-none bg-transparent cursor-pointer hover:bg-[var(--color-hover-bg)]',
  action: 'tm-error-action px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]',
}

function clock(value: string | number | undefined): string {
  if (value === undefined) return '—'
  const iso = typeof value === 'number' ? new Date(value).toISOString() : value
  return iso.slice(11, 23) || '—'
}

function errorText(entry: LogEntry | null): string {
  if (!entry?.error) return ''
  return typeof entry.error === 'string' ? entry.error : (entry.error.message ?? '')
}

export function ErrorView() {
  const entries = useMonitorStore((s) => s.entries)
  const detailed = useMonitorStore((s) => s.detailed)
  const focusTrace = useMonitorStore((s) => s.focusTrace)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null)
  const { logs, log } = useMonitorHost()

  const groups = useMemo(() => groupErrorsByFingerprint(entries), [entries])
  const recoveries = useMemo(() => findRecoveryReports(entries), [entries])
  const selected = groups.find((g) => g.fingerprint === selectedFingerprint) ?? groups[0] ?? null
  const sample = selected?.sample ?? null
  const crumbs = flattenBreadcrumbs(sample)
  const errorCount = useMemo(() => sortByTime(entries).filter((e) => e.level === 'ERROR' || e.category === 'error').length, [entries])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-app)]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] shrink-0" style={{ fontSize: 'var(--font-size-sm)' }}>
        <ShieldAlert className="h-3.5 w-3.5 text-[var(--color-danger)]" />
        <span className="font-semibold text-[var(--color-text-primary)]">异常与崩溃</span>
        <span className="text-[var(--color-text-muted)]">{errorCount} 条 · {groups.length} 个指纹 · {recoveries.length} 份恢复报告</span>
        <button
          className={`${TM_UI.action} ml-auto flex items-center gap-1`}
          style={{ fontSize: 'var(--font-size-xs)' }}
          disabled={!logs.exportBundle}
          onClick={() => void downloadDiagnosticBundle(logs, log)}
        >
          <Package className="h-3 w-3" /> 导出诊断包
        </button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-[360px] min-w-[280px] border-r border-[var(--color-border-subtle)] overflow-y-auto">
          {recoveries.length > 0 && (
            <section className="p-3">
              <div className="font-semibold text-[var(--color-warning)] mb-2" style={{ fontSize: 'var(--font-size-sm)' }}>上次会话异常退出</div>
              {recoveries.map((report, index) => (
                <div key={report.id ?? index} className="border border-[var(--color-warning-border)] rounded-md bg-[var(--color-warning-soft)] p-2 mb-2" style={{ fontSize: 'var(--font-size-xs)' }}>
                  <div className="text-[var(--color-text-primary)]">{report.message || report.label}</div>
                  <div className="text-[var(--color-text-muted)] font-mono mt-1">
                    {report.timestamp} · session={report.sessionId ?? '—'}
                  </div>
                  <div className="text-[var(--color-text-muted)] mt-1">
                    面包屑 {report.breadcrumbs?.length ?? 0} 条 · dump {report.dumpRef?.available ? report.dumpRef.file ?? '有' : '无'}
                  </div>
                  <button
                    className={`${TM_UI.action} mt-1`}
                    style={{ fontSize: 'var(--font-size-xs)' }}
                    onClick={() => { setSelectedEntry(report); useMonitorStore.setState({ activeTab: 'log' }) }}
                  >
                    查看原始报告
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="p-3">
            <div className="font-semibold text-[var(--color-text-secondary)] mb-2" style={{ fontSize: 'var(--font-size-sm)' }}>错误指纹</div>
            {groups.length === 0 ? (
              <EmptyState size="sm" icon={<ShieldAlert className="h-5 w-5" />} title="暂无异常日志" />
            ) : (
              <div className="border border-[var(--color-border-subtle)] rounded-md overflow-hidden bg-[var(--color-surface)]">
                {groups.map((group) => (
                  <button
                    key={group.fingerprint}
                    className={TM_UI.group}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      background: selected?.fingerprint === group.fingerprint ? 'var(--color-selected-bg)' : undefined,
                    }}
                    onClick={() => setSelectedFingerprint(group.fingerprint)}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-danger)] shrink-0" />
                    <span className="flex-1 truncate text-[var(--color-text-primary)]">{errorText(group.sample) || group.sample.label || group.fingerprint}</span>
                    <span className="text-[var(--color-text-muted)] tabular-nums shrink-0">×{group.count}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {!selected || !sample ? (
            <EmptyState size="md" icon={<ShieldAlert className="h-6 w-6" />} title="选择一个指纹查看崩溃上下文" />
          ) : (
            <>
              <div className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] p-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-md)' }}>
                    {errorText(sample) || sample.label || '异常'}
                  </span>
                  <span className="font-mono text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>{selected.fingerprint}</span>
                  {sample.traceId && (
                    <button className={`${TM_UI.action} ml-auto`} style={{ fontSize: 'var(--font-size-xs)' }} onClick={() => focusTrace(sample.traceId!)}>
                      反查触发它的用户事件
                    </button>
                  )}
                </div>
                <div className="mt-2 text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>
                  {selected.count} 次 · 首次 {selected.firstSeen} · 最近 {selected.lastSeen} · 涉及 {selected.sessions.length} 个会话 · 面包屑 {selected.breadcrumbCount} 条
                </div>
                {detailed && sample.error && typeof sample.error !== 'string' && sample.error.stack && (
                  <pre className="mt-2 p-2 rounded bg-[var(--color-danger-soft)] text-[var(--color-danger)] overflow-x-auto whitespace-pre" style={{ fontSize: 'var(--font-size-xs)' }}>
                    {sample.error.stack}
                  </pre>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] p-3" style={{ fontSize: 'var(--font-size-xs)' }}>
                  <div className="font-semibold text-[var(--color-text-secondary)] mb-1">崩溃转储引用</div>
                  {sample.dumpRef?.available ? (
                    <div className="font-mono text-[var(--color-text-primary)] break-all">
                      {sample.dumpRef.dir}/{sample.dumpRef.file ?? '—'}<br />
                      {sample.dumpRef.size ?? 0} bytes · {sample.dumpRef.createdAt ?? '—'}
                    </div>
                  ) : (
                    <div className="text-[var(--color-text-muted)]">当前无本地 minidump 引用（dumpRef.available=false）</div>
                  )}
                </div>
                <div className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] p-3" style={{ fontSize: 'var(--font-size-xs)' }}>
                  <div className="font-semibold text-[var(--color-text-secondary)] mb-1">运行环境</div>
                  {sample.env ? (
                    <div className="font-mono text-[var(--color-text-primary)] break-all">
                      {sample.env.platform}/{sample.env.arch} · electron {sample.env.electron ?? '—'} · chrome {sample.env.chrome ?? '—'}<br />
                      node {sample.env.node} · app {sample.env.appVersion ?? '—'} · pid {sample.env.pid}<br />
                      workspace {sample.env.workspaceId ?? '—'}
                    </div>
                  ) : (
                    <div className="text-[var(--color-text-muted)]">该样本未带 env（v1/v2 老日志或渲染侧异常）</div>
                  )}
                </div>
              </div>

              <div className="border border-[var(--color-border-subtle)] rounded-md bg-[var(--color-surface)] p-3">
                <div className="font-semibold text-[var(--color-text-secondary)] mb-2" style={{ fontSize: 'var(--font-size-sm)' }}>
                  崩溃前输入轨迹（breadcrumbs，D2 只随 error 同步落盘）
                </div>
                {crumbs.length === 0 ? (
                  <div className="text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-xs)' }}>该样本没有面包屑（可能是渲染侧异常或极短会话）</div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto">
                    {(detailed ? crumbs : crumbs.slice(-20)).map((crumb, index) => (
                      <div key={`${crumb.seq}-${index}`} className="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-b-0" style={{ fontSize: 'var(--font-size-xs)' }}>
                        <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(crumb.t)}</span>
                        <span className="text-[var(--color-accent)] shrink-0" style={{ width: 76 }}>{crumb.type}</span>
                        <span className="font-mono text-[var(--color-text-secondary)] truncate">
                          {crumb.target?.tag ?? '—'}{crumb.target?.id ? `#${crumb.target.id}` : ''}{crumb.target?.label ? ` ${crumb.target.label}` : ''}
                        </span>
                        <span className="text-[var(--color-text-muted)] ml-auto shrink-0">{crumb.view ?? ''}</span>
                      </div>
                    ))}
                    {!detailed && crumbs.length > 20 && (
                      <div className="text-[var(--color-text-muted)] pt-1" style={{ fontSize: 'var(--font-size-xs)' }}>仅显示最近 20 条，开启「详细」查看全部 {crumbs.length} 条</div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="font-semibold text-[var(--color-text-secondary)] mb-2" style={{ fontSize: 'var(--font-size-sm)' }}>同指纹样本</div>
                <div className="border border-[var(--color-border-subtle)] rounded-md overflow-hidden bg-[var(--color-surface)]">
                  {selected.entries.map((entry, index) => (
                    <button
                      key={entry.id ?? index}
                      className={TM_UI.group}
                      style={{ fontSize: 'var(--font-size-xs)' }}
                      onClick={() => { setSelectedEntry(entry); useMonitorStore.setState({ activeTab: 'log' }) }}
                    >
                      <span className="font-mono text-[var(--color-text-muted)] shrink-0">{clock(entry.timestamp)}</span>
                      <span className="text-[var(--color-text-primary)] truncate flex-1">{entry.label || entry.message}</span>
                      <span className="text-[var(--color-text-muted)] font-mono shrink-0">{entry.sessionId?.slice(-8) ?? '—'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
