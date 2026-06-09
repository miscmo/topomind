/**
 * 首页：知识库列表
 */
import { useMemo, useState } from 'react'
import { Book, FolderInput, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useTabStore } from '../../stores/tabs/tabStore'
import { isWebOpenablePath, openLocalPath } from '../../core/app-backend'
import { useHomeKnowledgeBases } from './model/useHomeKnowledgeBases'
import { useHomeCreateKB } from './model/useHomeCreateKB'
import { useHomeImportKB } from './model/useHomeImportKB'
import { useHomeImportJobs } from './model/useHomeImportJobs'
import { useMonitorStore } from '../monitor/model/monitorStore'
import { KnowledgeBaseGrid } from './components/KnowledgeBaseGrid'
import { CreateKBDialog } from './components/CreateKBDialog'
import { ImportKBDialog } from './components/ImportKBDialog'
import { KBSettingsDialog } from './components/KBSettingsDialog'
import { TrashDialog } from './components/TrashDialog'
import type { KBItem } from './model/useHomeKnowledgeBases'
import type { LocalImportJobRecord } from '../../types/local-sync'

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

function formatImportStage(stage: LocalImportJobRecord['stage']) {
  switch (stage) {
    case 'source-import':
      return '文件接收'
    case 'scan':
      return '附件扫描'
    case 'import-structure':
      return '结构导入'
    case 'push':
      return '等待结构同步'
    case 'import-attachments':
      return '附件建单/执行'
    case 'report':
      return '生成报告'
    default:
      return stage
  }
}

function formatImportStatus(status: LocalImportJobRecord['status']) {
  switch (status) {
    case 'pending':
      return '排队中'
    case 'running':
      return '处理中'
    case 'done':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

function getImportStatusClass(status: LocalImportJobRecord['status']) {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'cancelled') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '-'
  const deltaMs = Date.now() - timestamp
  const deltaMinutes = Math.max(0, Math.floor(deltaMs / 60000))
  if (deltaMinutes < 1) return '刚刚'
  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`
  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours} 小时前`
  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays} 天前`
}

function getPathBasename(path: string) {
  const normalized = path.replace(/[\\/]+/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

export default function HomePage() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const openMonitorTab = useTabStore((s) => s.openMonitorTab)
  const setMonitorActiveTab = useMonitorStore((s) => s.setActiveTab)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [trashVisible, setTrashVisible] = useState(false)
  const [selectedKb, setSelectedKb] = useState<KBItem | null>(null)
  const {
    loading,
    kbs,
    openKB,
    refreshKBList,
  } = useHomeKnowledgeBases({
    setMessage,
    setMessageError,
  })
  const {
    showCreateSheet,
    createName,
    createLoading,
    createError,
    setCreateName,
    setCreateError,
    openCreateSheet,
    closeCreateSheet,
    handleCreateKB,
  } = useHomeCreateKB({
    refreshKBList,
  })
  const {
    latestImportJob,
    latestImportJobLoading,
    refreshLatestImportJob,
    rememberImportJob,
  } = useHomeImportJobs({
    refreshKBList,
    setMessage,
    setMessageError,
  })
  const {
    showImportSheet,
    importFile,
    importLoading,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportFile,
    handleImportKB,
  } = useHomeImportKB({
    setMessage,
    setMessageError,
    onImportJobCreated: rememberImportJob,
  })

  const latestImportSummary = useMemo(() => {
    if (!latestImportJob) return null
    const structureImport = asRecord(latestImportJob.summaryJson?.structureImport)
    const attachmentExecution = asRecord(latestImportJob.summaryJson?.attachmentExecution)
    const structurePush = asRecord(latestImportJob.summaryJson?.structurePush)
    return {
      knowledgeBaseCount: getSummaryNumber(structureImport, 'knowledgeBaseCreatedCount'),
      cardCount: getSummaryNumber(structureImport, 'cardCreatedCount'),
      attachmentDoneCount: getSummaryNumber(attachmentExecution, 'doneCount'),
      attachmentTotalCount: getSummaryNumber(attachmentExecution, 'totalCount'),
      structurePendingCount: getSummaryNumber(structurePush, 'pendingCount'),
    }
  }, [latestImportJob])
  const latestImportedKnowledgeBaseId = useMemo(() => {
    if (!latestImportJob) return null
    const structureImport = asRecord(latestImportJob.summaryJson?.structureImport)
    return getSummaryString(structureImport, 'knowledgeBaseId')
  }, [latestImportJob])
  const latestImportedKnowledgeBase = useMemo(() => {
    if (!latestImportedKnowledgeBaseId) return null
    return kbs.find((kb) => kb.id === latestImportedKnowledgeBaseId) ?? null
  }, [kbs, latestImportedKnowledgeBaseId])
  const latestImportReportUrl = useMemo(() => {
    const reportPath = latestImportJob?.reportPath
    return reportPath && isWebOpenablePath(reportPath) ? reportPath : null
  }, [latestImportJob])

  function openSettings(kb: KBItem) {
    setSelectedKb(kb)
    setSettingsVisible(true)
  }

  async function handleOpenLatestImportReport() {
    const reportPath = latestImportJob?.reportPath
    if (!reportPath) return
    try {
      await openLocalPath(reportPath)
      setMessage('')
      setMessageError(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打开导入报告失败')
      setMessageError(true)
    }
  }

  return (
    <div id="home-modal" className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 知识库列表 */}
      <div className="flex-1 overflow-y-auto bg-background p-8 md:p-12 relative">
        <div className="mx-auto w-full max-w-7xl">
          {loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <span className="ml-3 text-sm font-medium text-muted-foreground">加载中...</span>
            </div>
          )}

          <div className="mb-8 flex items-end justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">我的知识库</h2>
              <p className="text-sm text-muted-foreground">当前使用 LocalDB 镜像读链路，旧文件系统入口已停用</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={openCreateSheet}
                type="button"
                disabled={!currentWorkspaceId}
              >
                <Plus className="mr-2 h-4 w-4" />
                新建知识库
              </button>
              <button
                className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={openImportSheet}
                type="button"
                disabled={!currentWorkspaceId}
              >
                <FolderInput className="mr-2 h-4 w-4" />
                ZIP 导入
              </button>
              <button
                className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => setTrashVisible(true)}
                type="button"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                知识库回收站
              </button>
            </div>
          </div>
          
          {message && (
            <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${messageError ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
              {message}
            </div>
          )}

          {latestImportJob && (
            <div className="mb-6 rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-foreground">最近导入任务</div>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getImportStatusClass(latestImportJob.status)}`}>
                      {formatImportStatus(latestImportJob.status)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatImportStage(latestImportJob.stage)} · 更新于 {formatRelativeTime(latestImportJob.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {getPathBasename(latestImportJob.sourcePath)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    来源目录：{latestImportJob.sourcePath}
                  </div>
                  {latestImportJob.reportPath && !latestImportReportUrl && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      报告路径：{latestImportJob.reportPath}。当前 Web 版暂不支持直接打开本地报告文件。
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {latestImportSummary?.knowledgeBaseCount !== null && latestImportSummary?.knowledgeBaseCount !== undefined && (
                      <span>知识库 {latestImportSummary.knowledgeBaseCount}</span>
                    )}
                    {latestImportSummary?.cardCount !== null && latestImportSummary?.cardCount !== undefined && (
                      <span>节点 {latestImportSummary.cardCount}</span>
                    )}
                    {latestImportSummary?.attachmentDoneCount !== null && latestImportSummary?.attachmentDoneCount !== undefined && (
                      <span>
                        附件 {latestImportSummary.attachmentDoneCount}
                        {latestImportSummary.attachmentTotalCount !== null && latestImportSummary.attachmentTotalCount !== undefined
                          ? ` / ${latestImportSummary.attachmentTotalCount}`
                          : ''}
                      </span>
                    )}
                    {latestImportSummary?.structurePendingCount !== null && latestImportSummary?.structurePendingCount !== undefined && latestImportSummary.structurePendingCount > 0 && (
                      <span>待同步结构 {latestImportSummary.structurePendingCount}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {latestImportReportUrl && (
                    <button
                      className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      onClick={() => { void handleOpenLatestImportReport() }}
                      type="button"
                    >
                      查看导入报告
                    </button>
                  )}
                  {latestImportJob.status === 'done' && latestImportedKnowledgeBase && (
                    <button
                      className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      onClick={() => openKB(latestImportedKnowledgeBase)}
                      type="button"
                    >
                      打开知识库
                    </button>
                  )}
                  <button
                    className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => { void refreshLatestImportJob() }}
                    type="button"
                    disabled={latestImportJobLoading}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${latestImportJobLoading ? 'animate-spin' : ''}`} />
                    刷新状态
                  </button>
                  <button
                    className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setMonitorActiveTab('import')
                        openMonitorTab()
                      }}
                    type="button"
                  >
                    查看监控
                  </button>
                </div>
              </div>
              {latestImportJob.status === 'done' && !latestImportedKnowledgeBase && latestImportedKnowledgeBaseId && (
                <div className="mt-3 text-xs text-muted-foreground">
                  导入任务已完成，正在等待首页知识库列表刷新后展示结果。
                </div>
              )}
            </div>
          )}

          <div className="mb-6 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            已切到云端本地镜像主链路。当前已支持知识库列表、详情打开、设置保存、删除、回收站恢复与清空，以及首页创建导入任务与查看最近导入状态；旧文件系统导入主链已停用。
          </div>
          
          {!loading && kbs.length === 0 ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 text-center">
              <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/50">
                  <Book className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">暂无知识库</h3>
                <p className="mb-8 mt-2 text-sm text-muted-foreground">
                  当前工作区的本地镜像中还没有知识库数据。请先完成云端 bootstrap 或后续云端写入流程。
                </p>
              </div>
            </div>
          ) : (
            <KnowledgeBaseGrid
              kbs={kbs}
              onOpenKB={(kb) => {
                openKB(kb)
              }}
              onOpenSettings={openSettings}
            />
          )}
        </div>
      </div>
      <KBSettingsDialog
        visible={settingsVisible}
        kb={selectedKb}
        onClose={() => {
          setSettingsVisible(false)
          setSelectedKb(null)
        }}
        refreshKBList={refreshKBList}
      />
      <CreateKBDialog
        visible={showCreateSheet}
        name={createName}
        loading={createLoading}
        error={createError}
        onNameChange={setCreateName}
        onErrorClear={() => setCreateError('')}
        onClose={closeCreateSheet}
        onSubmit={() => { void handleCreateKB() }}
      />
      <ImportKBDialog
        visible={showImportSheet}
        fileName={importFile?.name || ''}
        loading={importLoading}
        error={importError}
        onClose={closeImportSheet}
        onSelectFile={handleSelectImportFile}
        onSubmit={() => { void handleImportKB() }}
      />
      <TrashDialog
        visible={trashVisible}
        onClose={() => setTrashVisible(false)}
        refreshKBList={refreshKBList}
      />
    </div>
  )
}


