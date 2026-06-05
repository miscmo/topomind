import { useMemo, useState } from 'react'

import type {
  PluginActivationReasonSnapshot as ActivationReason,
  PluginDiagnosticsSnapshot as PluginDiagnostics,
  PluginRuntimeRecordSnapshot as RuntimeBindingRecord,
  PluginStateSnapshot as PluginState,
} from '../../../public'
import { useMonitorHost } from '../hostContext'
import { useMonitorStore } from '../model/monitorStore'

function stateTone(state: PluginState): string {
  if (state === 'failed') {
    return 'text-[var(--color-danger)] bg-[var(--color-danger-soft)] border-[var(--color-danger)]'
  }

  if (state === 'disabled') {
    return 'text-[var(--color-text-muted)] bg-[var(--color-bg-muted)] border-[var(--color-border)]'
  }

  if (state === 'running') {
    return 'text-[var(--color-primary)] bg-[var(--color-primary-soft)] border-[var(--color-primary)]'
  }

  return 'text-[var(--color-text-secondary)] bg-[var(--color-bg-muted)] border-[var(--color-border)]'
}

function formatTime(value?: string): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatActivationReason(reason?: ActivationReason): string {
  if (!reason) {
    return '—'
  }

  switch (reason.type) {
    case 'app-ready':
      return '应用启动'
    case 'workspace-ready':
      return '工作区就绪'
    case 'command':
      return `命令 ${reason.commandId}`
    case 'view':
      return `视图 ${reason.viewId}`
  }
}

function formatRuntimeRecord(record: RuntimeBindingRecord): string {
  return `${record.contributionType}:${record.contributionId}`
}

export function PluginDiagnosticsPanel() {
  const diagnostics = useMonitorStore((s) => s.pluginDiagnostics)
  const selectedPluginId = useMonitorStore((s) => s.selectedPluginId)
  const setSelectedPluginId = useMonitorStore((s) => s.setSelectedPluginId)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { plugins } = useMonitorHost()

  const sortedDiagnostics = useMemo(
    () =>
      [...diagnostics].sort((a, b) => {
        const rank = (item: PluginDiagnostics) => {
          if (item.state === 'failed') return 0
          if (item.state === 'disabled') return 1
          if (item.state === 'running') return 2
          return 3
        }

        return rank(a) - rank(b) || a.pluginId.localeCompare(b.pluginId)
      }),
    [diagnostics],
  )

  const selectedPlugin =
    sortedDiagnostics.find((item) => item.pluginId === selectedPluginId) ?? sortedDiagnostics[0] ?? null

  const summary = useMemo(
    () => ({
      total: diagnostics.length,
      failed: diagnostics.filter((item) => item.state === 'failed').length,
      disabled: diagnostics.filter((item) => item.state === 'disabled').length,
      running: diagnostics.filter((item) => item.state === 'running').length,
    }),
    [diagnostics],
  )

  const retryActivation = async () => {
    if (!selectedPlugin?.lastActivationReason) {
      return
    }

    setBusy(true)
    setActionMessage(null)

    try {
      await plugins.retryActivation(selectedPlugin.pluginId)
      setActionMessage('已触发重试激活')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const copySnapshot = async () => {
    if (!selectedPlugin) {
      return
    }

    await navigator.clipboard.writeText(JSON.stringify(selectedPlugin, null, 2))
    setActionMessage('已复制诊断快照')
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-[var(--color-bg-app)]">
      <div className="w-[340px] min-w-[340px] border-r border-[var(--color-border-subtle)] flex flex-col bg-[var(--color-surface)]">
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">插件诊断</div>
          <div className="mt-2 flex gap-2 text-[11px] text-[var(--color-text-secondary)] flex-wrap">
            <span>总数 {summary.total}</span>
            <span>运行 {summary.running}</span>
            <span>失败 {summary.failed}</span>
            <span>禁用 {summary.disabled}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          {sortedDiagnostics.length === 0 ? (
            <div className="px-3 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
              当前没有可展示的插件诊断数据
            </div>
          ) : (
            sortedDiagnostics.map((item) => (
              <button
                key={item.pluginId}
                type="button"
                className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                  selectedPlugin?.pluginId === item.pluginId
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-hover-bg)]'
                }`}
                onClick={() => setSelectedPluginId(item.pluginId)}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {item.manifest.displayName}
                    </div>
                    <div className="truncate text-[11px] text-[var(--color-text-muted)]">{item.pluginId}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateTone(item.state)}`}>
                    {item.state}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                  运行时绑定 {item.runtimeRecords.length}
                </div>
                {item.lastErrorMessage && (
                  <div className="mt-1 line-clamp-2 text-[11px] text-[var(--color-danger)]">
                    {item.lastErrorMessage}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--color-bg-app)]">
        {!selectedPlugin ? (
          <div className="h-full flex items-center justify-center text-[13px] text-[var(--color-text-muted)]">
            选择一个插件查看诊断详情
          </div>
        ) : (
          <div className="max-w-[960px] p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                  {selectedPlugin.manifest.displayName}
                </div>
                <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">{selectedPlugin.pluginId}</div>
              </div>
              <div className="flex items-center gap-2">
                {selectedPlugin.lastActivationReason && selectedPlugin.state !== 'running' && selectedPlugin.state !== 'disabled' && (
                  <button
                    type="button"
                    className="h-8 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:opacity-50"
                    onClick={() => {
                      void retryActivation()
                    }}
                    disabled={busy}
                  >
                    重试激活
                  </button>
                )}
                <button
                  type="button"
                  className="h-8 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]"
                  onClick={() => {
                    void copySnapshot()
                  }}
                >
                  复制快照
                </button>
              </div>
            </div>

            {actionMessage && (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
                {actionMessage}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.5px] text-[var(--color-text-muted)]">状态</div>
                <div className="mt-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {selectedPlugin.state}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.5px] text-[var(--color-text-muted)]">最近激活原因</div>
                <div className="mt-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {formatActivationReason(selectedPlugin.lastActivationReason)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.5px] text-[var(--color-text-muted)]">最近失败时间</div>
                <div className="mt-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {formatTime(selectedPlugin.lastFailedAt)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.5px] text-[var(--color-text-muted)]">运行时绑定数</div>
                <div className="mt-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {selectedPlugin.runtimeRecords.length}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">最近错误</div>
              <div className="mt-2 text-[12px] text-[var(--color-text-secondary)] break-all">
                {selectedPlugin.lastErrorMessage ?? '—'}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">运行时绑定</div>
              <div className="mt-3 space-y-2">
                {selectedPlugin.runtimeRecords.length === 0 ? (
                  <div className="text-[12px] text-[var(--color-text-muted)]">当前没有运行时绑定记录</div>
                ) : (
                  selectedPlugin.runtimeRecords.map((record) => (
                    <div
                      key={`${record.contributionType}:${record.contributionId}`}
                      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                          {formatRuntimeRecord(record)}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">{record.status}</div>
                      </div>
                      {record.errorMessage && (
                        <div className="mt-1 text-[11px] text-[var(--color-danger)]">{record.errorMessage}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Manifest 摘要</div>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3 text-[11px] text-[var(--color-text-secondary)]">
                {JSON.stringify(
                  {
                    id: selectedPlugin.manifest.id,
                    displayName: selectedPlugin.manifest.displayName,
                    activationEvents: selectedPlugin.manifest.activationEvents,
                    permissions: selectedPlugin.manifest.permissions,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
