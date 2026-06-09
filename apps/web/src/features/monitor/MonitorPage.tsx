/**
 * 日志性能监控页面
 * 通过菜单"视图 → 日志性能监控"打开的独立窗口
 */
import { useEffect, useState } from 'react'
import { useMonitorStore, type LogEntry } from './model/monitorStore'
import PerformanceTab from './PerformanceTab'
import { requestCloudSyncWake } from '../../application/cloud/events'
import { useCloudSyncEngineDebugStore } from '../../application/cloud/syncEngineDebugStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { getFileCacheHealth } from '../../core/file-cache-backend'
import { getAttachmentDebugHealth } from '../../core/attachment-debug-backend'
import { getImportDebugHealth } from '../../core/import-debug-backend'
import { isWebOpenablePath, openLocalPath } from '../../core/app-backend'
import {
  logGetBuffer,
  logGetAvailableDates,
  logSubscribe,
  logUnsubscribe,
  logAction,
} from '../../core/log-backend'
import {
  getSyncDebugSnapshot,
  listSyncDebugAttachmentJobs,
  listSyncDebugConflicts,
  listSyncDebugImportJobs,
  listSyncDebugOutboxItems,
  resolveSyncDebugConflictUseLocal,
  resumeSyncDebugImportJob,
  retrySyncDebugAttachmentJob,
  retrySyncDebugOutboxItem,
} from '../../core/sync-debug-backend'
import { Sidebar } from './components/Sidebar'
import { FilterBar } from './components/FilterBar'
import { LogList } from './components/LogList'
import { DetailPanel } from './components/DetailPanel'
import type {
  LocalAttachmentUploadJob,
  LocalImportJobRecord,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
} from '../../types/local-sync'

function formatTimestamp(value: string | null) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

function formatCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-'
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function shortenId(value: string | null | undefined) {
  if (!value) return '-'
  return value.length <= 8 ? value : value.slice(0, 8)
}

function StatusMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 font-medium text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function HealthBadge({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        ready ? 'bg-[#d1fae5] text-[#047857]' : 'bg-[#fef3c7] text-[#b45309]'
      }`}
    >
      {ready ? '已就绪' : '待补齐'}
    </span>
  )
}

function DirectoryStatusRow({
  label,
  directoryPath,
  exists,
}: {
  label: string
  directoryPath: string
  exists: boolean
}) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--color-text-primary)]">{label}</div>
        <HealthBadge ready={exists} />
      </div>
      <div className="mt-1 break-all text-[var(--color-text-muted)]">{directoryPath}</div>
    </div>
  )
}

function SyncDetailList({
  title,
  loading,
  error,
  emptyText,
  children,
}: {
  title: string
  loading: boolean
  error: string
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</div>
        <div className="text-[11px] text-[var(--color-text-muted)]">{loading ? '读取中' : '只读'}</div>
      </div>
      {error ? (
        <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
          {error}
        </div>
      ) : loading ? (
        <div className="mt-3 rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
          正在读取...
        </div>
      ) : (
        <div className="mt-3">{children || <div className="text-[12px] text-[var(--color-text-muted)]">{emptyText}</div>}</div>
      )}
    </div>
  )
}

function OutboxItemRow({
  item,
  actionPending,
  onRetry,
}: {
  item: LocalSyncOutboxItem
  actionPending: boolean
  onRetry: (item: LocalSyncOutboxItem) => void
}) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--color-text-primary)]">
          {item.entityType} / {item.operation}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[var(--color-text-muted)]">{item.status}</div>
          {item.status === 'failed' && (
            <button
              type="button"
              onClick={() => onRetry(item)}
              disabled={actionPending}
              className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              重试
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        entity {shortenId(item.entityId)} · outbox {shortenId(item.id)} · attempt {item.attemptCount}
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        retry {formatTimestamp(item.nextRetryAt)} · ack {formatCount(item.ackedEventId)}
      </div>
      {(item.lastErrorCode || item.lastErrorMessage) && (
        <div className="mt-1 text-[#b91c1c]">
          {item.lastErrorCode || 'error'} {item.lastErrorMessage ? `· ${item.lastErrorMessage}` : ''}
        </div>
      )}
    </div>
  )
}

function ConflictItemRow({
  item,
  actionPending,
  onUseLocalRetry,
}: {
  item: LocalSyncConflictRecord
  actionPending: boolean
  onUseLocalRetry: (item: LocalSyncConflictRecord) => void
}) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--color-text-primary)]">
          {item.entityType} / {item.conflictType}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[var(--color-text-muted)]">{item.status}</div>
          {item.status === 'open' && item.serverVersion !== null && (
            <button
              type="button"
              onClick={() => onUseLocalRetry(item)}
              disabled={actionPending}
              className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              按本地重试
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        entity {shortenId(item.entityId)} · outbox {shortenId(item.outboxId)}
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        client v{formatCount(item.clientBaseVersion)} / server v{formatCount(item.serverVersion)} · event{' '}
        {formatCount(item.serverEventId)}
      </div>
      {(item.errorCode || item.errorMessage) && (
        <div className="mt-1 text-[#b91c1c]">
          {item.errorCode || 'conflict'} {item.errorMessage ? `· ${item.errorMessage}` : ''}
        </div>
      )}
    </div>
  )
}

function formatSummaryPreview(summary: Record<string, unknown>) {
  const entries = Object.entries(summary)
  if (entries.length === 0) return '-'
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? '[object]' : String(value)}`)
    .join(' · ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getSummaryNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getSummaryString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getOpenableReportUrl(reportPath: string | null): string | null {
  return reportPath && isWebOpenablePath(reportPath) ? reportPath : null
}

async function loadImportDetailsSnapshot(workspaceId: string) {
  const [attachmentUploadJobs, importJobs] = await Promise.all([
    listSyncDebugAttachmentJobs({
      workspaceId,
      limit: 8,
      statuses: ['uploading', 'failed', 'pending', 'uploaded', 'committing'],
    }),
    listSyncDebugImportJobs({
      workspaceId,
      limit: 8,
      statuses: ['running', 'failed', 'pending', 'done'],
    }),
  ])
  return { attachmentUploadJobs, importJobs }
}

function AttachmentJobRow({
  item,
  actionPending,
  onRetry,
}: {
  item: LocalAttachmentUploadJob
  actionPending: boolean
  onRetry: (item: LocalAttachmentUploadJob) => void
}) {
  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--color-text-primary)]">{item.fileName}</div>
        <div className="flex items-center gap-2">
          <div className="text-[var(--color-text-muted)]">{item.status}</div>
          {item.status === 'failed' && (
            <button
              type="button"
              onClick={() => onRetry(item)}
              disabled={actionPending}
              className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              重试
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        kb {shortenId(item.knowledgeBaseId)} · card {shortenId(item.cardId)} · doc {shortenId(item.documentId)} · size {formatBytes(item.sizeBytes)}
      </div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        attempt {item.attemptCount} · updated {formatTimestamp(item.updatedAt)} · mime {item.mimeType}
      </div>
      {(item.lastErrorCode || item.lastErrorMessage) && (
        <div className="mt-1 text-[#b91c1c]">
          {item.lastErrorCode || 'error'} {item.lastErrorMessage ? `· ${item.lastErrorMessage}` : ''}
        </div>
      )}
    </div>
  )
}

function ImportJobRow({
  item,
  actionPending,
  onOpenReport,
  onResume,
}: {
  item: LocalImportJobRecord
  actionPending: boolean
  onOpenReport: (item: LocalImportJobRecord) => void
  onResume: (item: LocalImportJobRecord) => void
}) {
  const reportUrl = getOpenableReportUrl(item.reportPath)
  const structurePush = asRecord(item.summaryJson?.structurePush)
  const attachmentImport = asRecord(item.summaryJson?.attachmentImport)
  const attachmentExecution = asRecord(item.summaryJson?.attachmentExecution)
  const summaryError = getSummaryString(item.summaryJson, 'error')

  return (
    <div className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--color-text-primary)]">{item.stage}</div>
        <div className="flex items-center gap-2">
          <div className="text-[var(--color-text-muted)]">{item.status}</div>
          {reportUrl && (
            <button
              type="button"
              onClick={() => onOpenReport(item)}
              disabled={actionPending}
              className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              查看报告
            </button>
          )}
          {item.status === 'failed' && (
            <button
              type="button"
              onClick={() => onResume(item)}
              disabled={actionPending}
              className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              恢复
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 break-all text-[var(--color-text-muted)]">source {item.sourcePath}</div>
      <div className="mt-1 text-[var(--color-text-muted)]">
        report {item.reportPath || '-'} · updated {formatTimestamp(item.updatedAt)}
      </div>
      {item.reportPath && !reportUrl && (
        <div className="mt-1 text-[var(--color-text-muted)]">
          当前 Web 版仅支持打开在线报告链接，本地报告文件请手动定位查看。
        </div>
      )}
      {structurePush && (
        <div className="mt-1 text-[var(--color-text-muted)]">
          structure push {getSummaryString(structurePush, 'status') || '-'} · clean{' '}
          {formatCount(getSummaryNumber(structurePush, 'cleanCount'))}/
          {formatCount(getSummaryNumber(structurePush, 'totalCount'))} · pending{' '}
          {formatCount(getSummaryNumber(structurePush, 'pendingCount'))} · failed{' '}
          {formatCount(getSummaryNumber(structurePush, 'failedCount'))}
        </div>
      )}
      {attachmentImport && (
        <div className="mt-1 text-[var(--color-text-muted)]">
          attachment enqueue {getSummaryString(attachmentImport, 'status') || '-'} · created{' '}
          {formatCount(getSummaryNumber(attachmentImport, 'createdCount'))} · reused{' '}
          {formatCount(getSummaryNumber(attachmentImport, 'reusedCount'))} · total{' '}
          {formatCount(getSummaryNumber(attachmentImport, 'totalCount'))}
        </div>
      )}
      {attachmentExecution && (
        <div className="mt-1 text-[var(--color-text-muted)]">
          attachment exec {getSummaryString(attachmentExecution, 'status') || '-'} · done{' '}
          {formatCount(getSummaryNumber(attachmentExecution, 'doneCount'))}/
          {formatCount(getSummaryNumber(attachmentExecution, 'totalCount'))} · failed{' '}
          {formatCount(getSummaryNumber(attachmentExecution, 'failedCount'))} · pending{' '}
          {formatCount(getSummaryNumber(attachmentExecution, 'pendingCount'))}
        </div>
      )}
      <div className="mt-1 text-[var(--color-text-muted)]">summary {formatSummaryPreview(item.summaryJson)}</div>
      {summaryError && <div className="mt-1 text-[#b91c1c]">error · {summaryError}</div>}
    </div>
  )
}

function SyncEngineStatusCard() {
  const debugState = useCloudSyncEngineDebugStore()
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const syncSnapshot = useMonitorStore((s) => s.syncSnapshot)
  const syncSnapshotLoading = useMonitorStore((s) => s.syncSnapshotLoading)
  const syncSnapshotError = useMonitorStore((s) => s.syncSnapshotError)
  const syncOutboxItems = useMonitorStore((s) => s.syncOutboxItems)
  const syncConflicts = useMonitorStore((s) => s.syncConflicts)
  const syncDetailsLoading = useMonitorStore((s) => s.syncDetailsLoading)
  const syncDetailsError = useMonitorStore((s) => s.syncDetailsError)
  const mainSnapshot = syncSnapshot?.sync ?? null
  const mainHealth = syncSnapshot?.health ?? null
  const [actionPendingId, setActionPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const handleManualSync = () => {
    logAction('同步:手动唤醒', 'MonitorPage', {
      workspaceId: currentWorkspaceId,
      previousStatus: debugState.status,
    })
    requestCloudSyncWake('monitor:manual-sync')
  }

  const handleRetryOutbox = async (item: LocalSyncOutboxItem) => {
    setActionPendingId(`outbox:${item.id}`)
    setActionError('')
    try {
      await retrySyncDebugOutboxItem({ outboxId: item.id })
      await logAction('同步:重试失败Outbox', 'MonitorPage', {
        workspaceId: currentWorkspaceId,
        outboxId: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
      })
      requestCloudSyncWake('monitor:retry-outbox')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  const handleResolveConflictUseLocal = async (item: LocalSyncConflictRecord) => {
    setActionPendingId(`conflict:${item.id}`)
    setActionError('')
    try {
      await resolveSyncDebugConflictUseLocal({ conflictId: item.id })
      await logAction('同步:按本地版本重试冲突', 'MonitorPage', {
        workspaceId: currentWorkspaceId,
        conflictId: item.id,
        outboxId: item.outboxId,
        entityType: item.entityType,
        entityId: item.entityId,
      })
      requestCloudSyncWake('monitor:resolve-conflict-use-local')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  const statusTone =
    debugState.status === 'running'
      ? 'text-[#2563eb] bg-[#dbeafe]'
      : debugState.status === 'idle'
        ? 'text-[#047857] bg-[#d1fae5]'
        : 'text-[var(--color-text-muted)] bg-[var(--color-bg-muted)]'

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/90 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">SyncEngine</div>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
              {debugState.status === 'running' ? '运行中' : debugState.status === 'idle' ? '空闲' : '未启用'}
            </span>
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            工作区 {currentWorkspaceId || '-'}，最近触发 {debugState.lastTriggerReason || '-'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleManualSync}
          disabled={!currentWorkspaceId}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-hover-bg)]"
        >
          立即同步
        </button>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Renderer 运行态</div>
            <div className="text-[11px] text-[var(--color-text-muted)]">{debugState.status}</div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <StatusMetric label="最近唤醒" value={formatTimestamp(debugState.lastWakeAt)} />
            <StatusMetric label="最近周期" value={formatTimestamp(debugState.lastCycleFinishedAt)} />
            <StatusMetric
              label="最近 Push"
              value={`${formatCount(debugState.lastPushedCount)} 项 / ${formatTimestamp(debugState.lastPushFinishedAt)}`}
            />
            <StatusMetric
              label="最近 Pull"
              value={`${formatCount(debugState.lastPulledCount)} 条 / ${formatTimestamp(debugState.lastPullFinishedAt)}`}
            />
          </div>
          {(debugState.syncError || debugState.pushError || debugState.pullError) && (
            <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
              同步错误：{debugState.syncError || debugState.pushError || debugState.pullError}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Main Snapshot</div>
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {!currentWorkspaceId
                ? '未选择工作区'
                : syncSnapshotLoading
                  ? '读取中'
                  : mainHealth?.ready
                    ? `stage: ${mainHealth.stage}`
                    : '未就绪'}
            </div>
          </div>
          {!currentWorkspaceId ? (
            <div className="mt-3 rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
              当前没有活动工作区，暂不读取主进程同步快照。
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <StatusMetric
                  label="Cursor"
                  value={`lastEventId ${formatCount(mainSnapshot?.cursor.lastEventId)}`}
                />
                <StatusMetric
                  label="最近 Pull/Push"
                  value={`${formatTimestamp(mainSnapshot?.cursor.lastPullAt ?? null)} / ${formatTimestamp(mainSnapshot?.cursor.lastPushAt ?? null)}`}
                />
                <StatusMetric
                  label="Outbox"
                  value={`pending ${formatCount(mainSnapshot?.outbox.pendingCount)} / failed ${formatCount(mainSnapshot?.outbox.failedCount)}`}
                />
                <StatusMetric
                  label="Conflict"
                  value={`open ${formatCount(mainSnapshot?.outbox.openConflictCount)} / conflicted ${formatCount(mainSnapshot?.outbox.conflictedCount)}`}
                />
                <StatusMetric
                  label="下一次重试"
                  value={formatTimestamp(mainSnapshot?.outbox.nextRetryAt ?? null)}
                />
                <StatusMetric
                  label="最老待同步"
                  value={formatTimestamp(mainSnapshot?.outbox.oldestPendingCreatedAt ?? null)}
                />
              </div>
              {syncSnapshotError && (
                <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
                  快照读取失败：{syncSnapshotError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {currentWorkspaceId && (
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <SyncDetailList
            title="Outbox 明细"
            loading={syncDetailsLoading}
            error={syncDetailsError}
            emptyText="当前没有待关注的 outbox 项。"
          >
            <div className="grid gap-2">
              {syncOutboxItems.length > 0
                ? syncOutboxItems.map((item) => (
                    <OutboxItemRow
                      key={item.id}
                      item={item}
                      actionPending={actionPendingId === `outbox:${item.id}`}
                      onRetry={handleRetryOutbox}
                    />
                  ))
                : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有待关注的 outbox 项。</div>}
            </div>
          </SyncDetailList>
          <SyncDetailList
            title="Conflict 明细"
            loading={syncDetailsLoading}
            error={syncDetailsError}
            emptyText="当前没有冲突记录。"
          >
            <div className="grid gap-2">
              {syncConflicts.length > 0
                ? syncConflicts.map((item) => (
                    <ConflictItemRow
                      key={item.id}
                      item={item}
                      actionPending={actionPendingId === `conflict:${item.id}`}
                      onUseLocalRetry={handleResolveConflictUseLocal}
                    />
                  ))
                : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有冲突记录。</div>}
            </div>
          </SyncDetailList>
        </div>
      )}
      {actionError && (
        <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
          调试动作失败：{actionError}
        </div>
      )}
    </div>
  )
}

function ImportRuntimeTab() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const fileCacheHealth = useMonitorStore((s) => s.fileCacheHealth)
  const attachmentHealth = useMonitorStore((s) => s.attachmentHealth)
  const importHealth = useMonitorStore((s) => s.importHealth)
  const importRuntimeLoading = useMonitorStore((s) => s.importRuntimeLoading)
  const importRuntimeError = useMonitorStore((s) => s.importRuntimeError)
  const attachmentUploadJobs = useMonitorStore((s) => s.attachmentUploadJobs)
  const importJobs = useMonitorStore((s) => s.importJobs)
  const importDetailsLoading = useMonitorStore((s) => s.importDetailsLoading)
  const importDetailsError = useMonitorStore((s) => s.importDetailsError)
  const setImportDetails = useMonitorStore((s) => s.setImportDetails)
  const setImportDetailsLoading = useMonitorStore((s) => s.setImportDetailsLoading)
  const setImportDetailsError = useMonitorStore((s) => s.setImportDetailsError)
  const setImportRuntime = useMonitorStore((s) => s.setImportRuntime)
  const availableDirectoryCount = fileCacheHealth?.directories.filter((entry) => entry.exists).length ?? 0
  const totalDirectoryCount = fileCacheHealth?.directories.length ?? 0
  const attachmentSupportedChannelCount = attachmentHealth?.supportedChannels.length ?? 0
  const importSupportedChannelCount = importHealth?.supportedChannels.length ?? 0
  const [actionPendingId, setActionPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const refreshImportDetails = async () => {
    if (!currentWorkspaceId) return
    setImportDetailsLoading(true)
    try {
      const details = await loadImportDetailsSnapshot(currentWorkspaceId)
      setImportDetails(details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setImportDetailsError(message)
      throw error
    }
  }

  const refreshImportRuntime = async () => {
    const nextImportHealth = await getImportDebugHealth()
    setImportRuntime({
      fileCacheHealth,
      attachmentHealth,
      importHealth: nextImportHealth,
    })
  }

  const handleRetryAttachmentJob = async (item: LocalAttachmentUploadJob) => {
    setActionPendingId(`attachment:${item.id}`)
    setActionError('')
    try {
      await retrySyncDebugAttachmentJob({ attachmentJobId: item.id })
      await logAction('同步:重试附件任务', 'MonitorPage', {
        workspaceId: currentWorkspaceId,
        attachmentJobId: item.id,
        knowledgeBaseId: item.knowledgeBaseId,
        cardId: item.cardId,
        documentId: item.documentId,
      })
      await refreshImportDetails()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  const handleResumeImportJob = async (item: LocalImportJobRecord) => {
    setActionPendingId(`import:${item.id}`)
    setActionError('')
    try {
      await resumeSyncDebugImportJob({ importJobId: item.id })
      await logAction('导入:恢复任务', 'MonitorPage', {
        workspaceId: currentWorkspaceId,
        importJobId: item.id,
        stage: item.stage,
        sourcePath: item.sourcePath,
      })
      await refreshImportDetails()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  const handleOpenImportReport = async (item: LocalImportJobRecord) => {
    const reportUrl = getOpenableReportUrl(item.reportPath)
    if (!reportUrl) {
      setActionError(item.reportPath
        ? '当前 Web 版仅支持打开在线报告链接，本地报告文件请手动定位查看。'
        : '当前导入任务还没有可打开的报告链接。')
      return
    }
    setActionPendingId(`import-report:${item.id}`)
    setActionError('')
    try {
      await openLocalPath(reportUrl)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  const handleStartImportJob = async () => {
    setActionError('当前 Web 版请在首页使用 ZIP 导入入口，监控页暂不直接发起导入。')
  }

  return (
    <div className="flex-1 overflow-auto bg-[var(--color-bg-app)] p-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-[16px] font-semibold text-[var(--color-text-primary)]">导入与附件观测</div>
                <HealthBadge ready={Boolean(fileCacheHealth?.ready) && Boolean(importHealth?.ready)} />
              </div>
              <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                当前工作区 {currentWorkspaceId || '-'}，纯 Web 版仅展示浏览器侧可用的导入/附件状态占位信息。
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] text-[var(--color-text-muted)]">
                {importRuntimeLoading ? '读取中' : importHealth?.processing ? 'worker 运行中' : 'worker 空闲'}
              </div>
              <button
                type="button"
                onClick={handleStartImportJob}
                disabled
                className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                首页发起 ZIP 导入
              </button>
            </div>
          </div>
          {importRuntimeError && (
            <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
              导入/附件状态读取失败：{importRuntimeError}
            </div>
          )}
          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Attachment Cache</div>
                <HealthBadge ready={Boolean(fileCacheHealth?.ready)} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <StatusMetric label="根目录" value={fileCacheHealth?.paths.rootDir || '-'} />
                <StatusMetric label="目录可用" value={`${availableDirectoryCount} / ${totalDirectoryCount || '-'}`} />
              </div>
              <div className="mt-3 grid gap-2">
                {fileCacheHealth?.directories?.length
                  ? fileCacheHealth.directories.map((entry) => (
                      <DirectoryStatusRow
                        key={entry.key}
                        label={entry.key}
                        directoryPath={entry.directoryPath}
                        exists={entry.exists}
                      />
                    ))
                  : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有可展示的附件缓存目录。</div>}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Attachment Runtime</div>
                <HealthBadge ready={Boolean(attachmentHealth?.ready)} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <StatusMetric label="阶段" value={attachmentHealth?.stage || '-'} />
                <StatusMetric label="支持通道" value={String(attachmentSupportedChannelCount)} />
                <StatusMetric label="当前任务" value={shortenId(attachmentHealth?.currentAttachmentJobId)} />
                <StatusMetric label="处理状态" value={attachmentHealth?.processing ? 'processing' : 'idle'} />
                <StatusMetric
                  label="主进程会话"
                  value={
                    attachmentHealth?.cloudSession
                      ? attachmentHealth.cloudSession.hasAccessToken
                        ? 'access token'
                        : attachmentHealth.cloudSession.hasRefreshToken
                          ? 'refresh only'
                          : 'missing'
                      : '-'
                  }
                />
                <StatusMetric
                  label="会话用户"
                  value={shortenId(attachmentHealth?.cloudSession?.userId)}
                />
              </div>
              <div className="mt-3 rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                当前附件 worker 会在主进程启动、建单和失败重试后串行消费 `attachment_upload_jobs`。
              </div>
              {attachmentHealth?.lastError && (
                <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
                  最近错误：{attachmentHealth.lastError}
                </div>
              )}
              <div className="mt-3 grid gap-2">
                {attachmentHealth?.supportedChannels?.length
                  ? attachmentHealth.supportedChannels.map((channel) => (
                      <div
                        key={channel}
                        className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]"
                      >
                        {channel}
                      </div>
                    ))
                  : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有可展示的附件调试通道。</div>}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Import Runtime</div>
                <HealthBadge ready={Boolean(importHealth?.ready)} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <StatusMetric label="阶段" value={importHealth?.stage || '-'} />
                <StatusMetric label="支持通道" value={String(importSupportedChannelCount)} />
                <StatusMetric label="当前任务" value={shortenId(importHealth?.currentImportJobId)} />
                <StatusMetric label="处理状态" value={importHealth?.processing ? 'processing' : 'idle'} />
              </div>
              <div className="mt-3 rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                现在可以直接从 Monitor 选择目录创建导入任务，worker 会串行消费 `import_jobs`。
              </div>
              {importHealth?.lastError && (
                <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
                  最近错误：{importHealth.lastError}
                </div>
              )}
              <div className="mt-3 grid gap-2">
                {importHealth?.supportedChannels?.length
                  ? importHealth.supportedChannels.map((channel) => (
                      <div
                        key={channel}
                        className="rounded-lg bg-[var(--color-bg-muted)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]"
                      >
                        {channel}
                      </div>
                    ))
                  : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有可展示的导入调试通道。</div>}
              </div>
            </div>
          </div>
          {currentWorkspaceId && (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <SyncDetailList
                title="Attachment Jobs"
                loading={importDetailsLoading}
                error={importDetailsError}
                emptyText="当前没有附件上传任务。"
              >
                <div className="grid gap-2">
                  {attachmentUploadJobs.length > 0
                    ? attachmentUploadJobs.map((item) => (
                        <AttachmentJobRow
                          key={item.id}
                          item={item}
                          actionPending={actionPendingId === `attachment:${item.id}`}
                          onRetry={handleRetryAttachmentJob}
                        />
                      ))
                    : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有附件上传任务。</div>}
                </div>
              </SyncDetailList>
              <SyncDetailList
                title="Import Jobs"
                loading={importDetailsLoading}
                error={importDetailsError}
                emptyText="当前没有导入任务。"
              >
                <div className="grid gap-2">
                  {importJobs.length > 0
                    ? importJobs.map((item) => (
                        <ImportJobRow
                          key={item.id}
                          item={item}
                          actionPending={
                            actionPendingId === `import:${item.id}`
                            || actionPendingId === `import-report:${item.id}`
                          }
                          onOpenReport={handleOpenImportReport}
                          onResume={handleResumeImportJob}
                        />
                      ))
                    : <div className="text-[12px] text-[var(--color-text-muted)]">当前没有导入任务。</div>}
                </div>
              </SyncDetailList>
            </div>
          )}
          {actionError && (
            <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[12px] text-[#b91c1c]">
              调试动作失败：{actionError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MonitorPage() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const streaming = useMonitorStore((s) => s.streaming)
  const appendEntries = useMonitorStore((s) => s.appendEntries)
  const setEntries = useMonitorStore((s) => s.setEntries)
  const setAvailableDates = useMonitorStore((s) => s.setAvailableDates)
  const setLoaded = useMonitorStore((s) => s.setLoaded)
  const setSyncSnapshot = useMonitorStore((s) => s.setSyncSnapshot)
  const setSyncSnapshotLoading = useMonitorStore((s) => s.setSyncSnapshotLoading)
  const setSyncSnapshotError = useMonitorStore((s) => s.setSyncSnapshotError)
  const setSyncDetails = useMonitorStore((s) => s.setSyncDetails)
  const setSyncDetailsLoading = useMonitorStore((s) => s.setSyncDetailsLoading)
  const setSyncDetailsError = useMonitorStore((s) => s.setSyncDetailsError)
  const setImportRuntime = useMonitorStore((s) => s.setImportRuntime)
  const setImportRuntimeLoading = useMonitorStore((s) => s.setImportRuntimeLoading)
  const setImportRuntimeError = useMonitorStore((s) => s.setImportRuntimeError)
  const setImportDetails = useMonitorStore((s) => s.setImportDetails)
  const setImportDetailsLoading = useMonitorStore((s) => s.setImportDetailsLoading)
  const setImportDetailsError = useMonitorStore((s) => s.setImportDetailsError)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // 初始化：加载缓冲区 + 可用日期
  useEffect(() => {
    logAction('页面:进入监控', 'MonitorPage', { timestamp: new Date().toISOString() })
    let mounted = true

    const init = async () => {
      const [buffer, dates] = await Promise.all([logGetBuffer(), logGetAvailableDates()])
      if (!mounted) return
      setEntries(buffer as LogEntry[])
      setAvailableDates(dates)
      setLoaded(true)
    }

    init()

    return () => {
      mounted = false
    }
  }, [setAvailableDates, setEntries, setLoaded])

  // 实时订阅：仅在 streaming=true 时接收新日志
  useEffect(() => {
    if (!streaming) return

    const handleEntry = (entry: unknown) => {
      appendEntries([entry as Parameters<typeof appendEntries>[0][0]])
    }

    logSubscribe(handleEntry)
    return () => {
      logUnsubscribe(handleEntry)
    }
  }, [appendEntries, streaming])

  useEffect(() => {
    if (!currentWorkspaceId) {
      setSyncSnapshot(null)
      setSyncSnapshotLoading(false)
      setSyncSnapshotError('')
      setSyncDetails({ outboxItems: [], conflicts: [] })
      setSyncDetailsLoading(false)
      setSyncDetailsError('')
      return
    }

    let disposed = false

    const loadSnapshot = async () => {
      setSyncSnapshotLoading(true)
      setSyncDetailsLoading(true)
      try {
        const [snapshot, outboxItems, conflicts] = await Promise.all([
          getSyncDebugSnapshot(currentWorkspaceId),
          listSyncDebugOutboxItems({
            workspaceId: currentWorkspaceId,
            limit: 8,
            statuses: ['sending', 'failed', 'conflicted', 'pending'],
          }),
          listSyncDebugConflicts({
            workspaceId: currentWorkspaceId,
            limit: 8,
            statuses: ['open', 'resolved'],
          }),
        ])
        if (disposed) return
        setSyncSnapshot(snapshot)
        setSyncDetails({ outboxItems, conflicts })
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setSyncSnapshotError(message)
        setSyncDetailsError(message)
      }
    }

    void loadSnapshot()
    const timerId = window.setInterval(() => {
      void loadSnapshot()
    }, 5000)

    return () => {
      disposed = true
      window.clearInterval(timerId)
    }
  }, [
    currentWorkspaceId,
    setSyncDetails,
    setSyncDetailsError,
    setSyncDetailsLoading,
    setSyncSnapshot,
    setSyncSnapshotError,
    setSyncSnapshotLoading,
  ])

  useEffect(() => {
    if (!currentWorkspaceId) {
      setImportDetails({ attachmentUploadJobs: [], importJobs: [] })
      setImportDetailsLoading(false)
      setImportDetailsError('')
      return
    }

    let disposed = false

    const loadImportDetails = async () => {
      setImportDetailsLoading(true)
      try {
        const { attachmentUploadJobs, importJobs } = await loadImportDetailsSnapshot(currentWorkspaceId)
        if (disposed) return
        setImportDetails({ attachmentUploadJobs, importJobs })
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setImportDetailsError(message)
      }
    }

    void loadImportDetails()
    const timerId = window.setInterval(() => {
      void loadImportDetails()
    }, 10000)

    return () => {
      disposed = true
      window.clearInterval(timerId)
    }
  }, [
    currentWorkspaceId,
    setImportDetails,
    setImportDetailsError,
    setImportDetailsLoading,
  ])

  useEffect(() => {
    let disposed = false

    const loadImportRuntime = async () => {
      setImportRuntimeLoading(true)
      try {
        const [fileCacheHealth, attachmentHealth, importHealth] = await Promise.all([
          getFileCacheHealth(),
          getAttachmentDebugHealth(),
          getImportDebugHealth(),
        ])
        if (disposed) return
        setImportRuntime({ fileCacheHealth, attachmentHealth, importHealth })
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setImportRuntimeError(message)
      }
    }

    void loadImportRuntime()
    const timerId = window.setInterval(() => {
      void loadImportRuntime()
    }, 10000)

    return () => {
      disposed = true
      window.clearInterval(timerId)
    }
  }, [setImportRuntime, setImportRuntimeError, setImportRuntimeLoading])

  return (
    <div className="flex w-full h-full bg-[var(--color-bg-app)] font-sans text-[13px] text-[var(--color-text-primary)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeTab === 'log' ? (
          <>
            <FilterBar />
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <LogList />
              <DetailPanel />
            </div>
          </>
        ) : activeTab === 'performance' ? (
          <PerformanceTab />
        ) : activeTab === 'sync' ? (
          <div className="flex-1 overflow-auto bg-[var(--color-bg-app)] p-4">
            <div className="mx-auto w-full max-w-6xl">
              <SyncEngineStatusCard />
            </div>
          </div>
        ) : (
          <ImportRuntimeTab />
        )}
      </div>
    </div>
  )
}

