import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudApi, type CloudImportJob } from '../../../core/cloud-api'
import type { LocalImportJobRecord } from '../../../types/local-sync'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../../../application/cloud/events'

interface UseHomeImportJobsOptions {
  refreshKBList: () => Promise<void>
  setMessage: (message: string) => void
  setMessageError: (isError: boolean) => void
}

function toTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortImportJobs(jobs: LocalImportJobRecord[]) {
  return [...jobs].sort((a, b) => {
    const updatedDiff = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt)
    if (updatedDiff !== 0) return updatedDiff
    return toTimestamp(b.createdAt) - toTimestamp(a.createdAt)
  })
}

function isTerminalStatus(status: LocalImportJobRecord['status']) {
  return status === 'done' || status === 'failed' || status === 'cancelled'
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

export function useHomeImportJobs({
  refreshKBList,
  setMessage,
  setMessageError,
}: UseHomeImportJobsOptions) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [latestImportJob, setLatestImportJob] = useState<LocalImportJobRecord | null>(null)
  const trackedImportJobIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(false)
  const previousJobRef = useRef<Pick<LocalImportJobRecord, 'id' | 'status'> | null>(null)
  const notifiedTerminalKeyRef = useRef<string | null>(null)

  const refreshLatestImportJob = useCallback(async () => {
    const trackedImportJobId = trackedImportJobIdRef.current
    if (!currentWorkspaceId || !trackedImportJobId) {
      setLatestImportJob(null)
      previousJobRef.current = null
      notifiedTerminalKeyRef.current = null
      return null
    }

    setLoading(true)
    try {
      const latest = toLocalImportJobRecord(
        await cloudApi.getWorkspaceImportJob(currentWorkspaceId, trackedImportJobId),
      )
      setLatestImportJob(latest)

      const previous = previousJobRef.current
      if (latest) {
        const terminalKey = `${latest.id}:${latest.status}`
        if (
          previous
          && previous.id === latest.id
          && previous.status !== latest.status
          && isTerminalStatus(latest.status)
          && notifiedTerminalKeyRef.current !== terminalKey
        ) {
          notifiedTerminalKeyRef.current = terminalKey
          if (latest.status === 'done') {
            await refreshKBList()
            setMessage('最近导入任务已完成，知识库列表已自动刷新。')
            setMessageError(false)
          } else if (latest.status === 'failed') {
            setMessage('最近导入任务失败，可在监控页查看错误并恢复任务。')
            setMessageError(true)
          }
        }
        previousJobRef.current = {
          id: latest.id,
          status: latest.status,
        }
      } else {
        previousJobRef.current = null
        notifiedTerminalKeyRef.current = null
      }

      return latest
    } finally {
      setLoading(false)
    }
  }, [currentWorkspaceId, refreshKBList, setMessage, setMessageError])

  const rememberImportJob = useCallback((job: LocalImportJobRecord) => {
    trackedImportJobIdRef.current = job.id
    previousJobRef.current = {
      id: job.id,
      status: job.status,
    }
    notifiedTerminalKeyRef.current = null
    setLatestImportJob(job)
  }, [])

  useEffect(() => {
    void refreshLatestImportJob().catch(() => {})
  }, [refreshLatestImportJob])

  useEffect(() => {
    if (!currentWorkspaceId || !trackedImportJobIdRef.current || isTerminalStatus(latestImportJob?.status ?? 'done')) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshLatestImportJob().catch(() => {})
    }, 4000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [currentWorkspaceId, latestImportJob?.status, refreshLatestImportJob])

  useEffect(() => {
    if (!trackedImportJobIdRef.current) return

    function handleLocalDbUpdated(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (!detail?.workspaceId || detail.workspaceId !== currentWorkspaceId) {
        return
      }
      void refreshLatestImportJob().catch(() => {})
    }

    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated)
    return () => {
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated)
    }
  }, [currentWorkspaceId, refreshLatestImportJob])

  return {
    latestImportJob,
    latestImportJobLoading: loading,
    refreshLatestImportJob,
    rememberImportJob,
  }
}

