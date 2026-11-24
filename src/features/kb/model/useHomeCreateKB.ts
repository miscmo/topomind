import { useState } from 'react'
import { useStorage } from '../../../core/storage'
import { logAction } from '../../../core/log-backend'

interface UseHomeCreateKBOptions {
  refreshKBList: () => Promise<void>
}

export function useHomeCreateKB({ refreshKBList }: UseHomeCreateKBOptions) {
  const storage = useStorage()
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const openCreateSheet = () => {
    logAction('kb.create', 'HomePage', {})
    logAction('kb.create_dialog', 'HomePage', {})
    setShowCreateSheet(true)
    setCreateName('')
    setCreateError('')
  }

  const closeCreateSheet = () => {
    logAction('kb.create_dialog', 'HomePage', { createName })
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
      await storage.createKB(name)
      logAction('kb.create', 'HomePage', { kbName: name })
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
