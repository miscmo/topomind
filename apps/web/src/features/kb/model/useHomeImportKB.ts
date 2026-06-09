import { useState } from 'react'
import { cloudApi, type CloudImportJob } from '../../../core/cloud-api'
import { logAction } from '../../../core/log-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useMonitorStore } from '../../monitor/model/monitorStore'
import type { LocalImportJobRecord } from '../../../types/local-sync'

interface UseHomeImportKBOptions {
  setMessage: (message: string) => void
  setMessageError: (isError: boolean) => void
  onImportJobCreated?: (job: LocalImportJobRecord) => Promise<unknown> | unknown
}

function toLocalImportJobRecord(job: CloudImportJob): LocalImportJobRecord {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    sourcePath: job.sourceFileName,
    stage: job.stage,
    status: job.status,
    summaryJson: job.summaryJson ?? {},
    reportPath: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export function useHomeImportKB({ setMessage, setMessageError, onImportJobCreated }: UseHomeImportKBOptions) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const openMonitorTab = useTabStore((s) => s.openMonitorTab)
  const setMonitorActiveTab = useMonitorStore((s) => s.setActiveTab)
  const [showImportSheet, setShowImportSheet] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')

  const openImportSheet = () => {
    logAction('点击导入 ZIP 知识库', 'HomePage', {})
    logAction('HomePage:导入知识库弹窗:打开', 'HomePage', {})
    setShowImportSheet(true)
    setImportFile(null)
    setImportError('')
  }

  const closeImportSheet = () => {
    logAction('HomePage:导入知识库弹窗:关闭', 'HomePage', { importFileName: importFile?.name || null })
    setShowImportSheet(false)
  }

  const handleSelectImportFile = (file: File | null) => {
    setImportFile(file)
    if (file) {
      setImportError('')
      logAction('HomePage:选择导入 ZIP 完成', 'HomePage', { fileName: file.name, sizeBytes: file.size })
    } else {
      logAction('HomePage:选择导入 ZIP 取消', 'HomePage', {})
    }
  }

  const handleImportKB = async () => {
    if (!importFile) {
      setImportError('请先选择一个 ZIP 文件')
      return
    }
    if (!currentWorkspaceId) {
      setImportError('当前没有活动工作区，无法创建导入任务。')
      return
    }
    setImportError('')
    setImportLoading(true)
    try {
      const createdJob = await cloudApi.createWorkspaceImport(currentWorkspaceId, importFile)
      const localJob = toLocalImportJobRecord(createdJob)
      logAction('知识库:创建 ZIP 导入任务', 'HomePage', {
        workspaceId: currentWorkspaceId,
        importJobId: createdJob.id,
        sourceFileName: createdJob.sourceFileName,
      })
      setShowImportSheet(false)
      setImportFile(null)
      await onImportJobCreated?.(localJob)
      setMonitorActiveTab('import')
      setMessage('已创建 ZIP 导入任务，正在后台处理；已为你切到监控页，可继续查看进度。')
      setMessageError(false)
      openMonitorTab()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportError(msg || '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  return {
    showImportSheet,
    importFile,
    importLoading,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportFile,
    handleImportKB,
  }
}
