import { useEffect, useRef, useState } from 'react'
import { useStorage } from '../../hooks/useStorage'
import { logAction } from '../../core/log-backend'

interface UseHomeCreateKBOptions {
  refreshKBList: () => Promise<void>
}

export function useHomeCreateKB({ refreshKBList }: UseHomeCreateKBOptions) {
  const storage = useStorage()
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const prevShowCreateSheet = useRef(false)
  useEffect(() => {
    if (showCreateSheet && !prevShowCreateSheet.current) {
      logAction('HomePage:新建知识库弹窗:打开', 'HomePage', {})
    } else if (!showCreateSheet && prevShowCreateSheet.current) {
      logAction('HomePage:新建知识库弹窗:关闭', 'HomePage', { createName })
    }
    prevShowCreateSheet.current = showCreateSheet
  }, [showCreateSheet, createName])

  const openCreateSheet = () => {
    logAction('点击新建知识库', 'HomePage', {})
    setShowCreateSheet(true)
    setCreateName('')
    setCreateError('')
  }

  const closeCreateSheet = () => {
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
