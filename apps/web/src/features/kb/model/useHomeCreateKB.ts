import { useState } from 'react'
import { syncWorkspacePullIntoLocalMirror } from '../../../application/cloud/localdb-sync'
import { cloudApi } from '../../../core/cloud-api'
import { useStorage } from '../../../core/storage'
import { logAction } from '../../../core/log-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

interface UseHomeCreateKBOptions {
  refreshKBList: () => Promise<void>
}

export function useHomeCreateKB({ refreshKBList }: UseHomeCreateKBOptions) {
  const storage = useStorage()
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const openCreateSheet = () => {
    logAction('点击新建知识库', 'HomePage', {})
    logAction('HomePage:新建知识库弹窗:打开', 'HomePage', {})
    setShowCreateSheet(true)
    setCreateName('')
    setCreateError('')
  }

  const closeCreateSheet = () => {
    logAction('HomePage:新建知识库弹窗:关闭', 'HomePage', { createName })
    setShowCreateSheet(false)
  }

  const handleCreateKB = async () => {
    const name = createName.trim()
    if (!name) {
      setCreateError('知识库名称不能为空')
      return
    }
    setCreateError('')
    setCreateLoading(true)
    try {
      if (currentWorkspaceId) {
        await cloudApi.createWorkspaceKnowledgeBase(currentWorkspaceId, {
          name,
          sortOrder: 0,
        })
        await syncWorkspacePullIntoLocalMirror(currentWorkspaceId)
      } else {
        await storage.createKB(name)
      }
      logAction('知识库:创建', 'HomePage', { kbName: name })
      setShowCreateSheet(false)
      setCreateName('')
      await refreshKBList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCreateError(msg || '创建失败')
    } finally {
      setCreateLoading(false)
    }
  }

  return {
    showCreateSheet,
    createName,
    createLoading,
    createError,
    setCreateName,
    setCreateError,
    openCreateSheet,
    closeCreateSheet,
    handleCreateKB,
  }
}
