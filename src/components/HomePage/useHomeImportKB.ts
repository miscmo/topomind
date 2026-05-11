import { useEffect, useRef, useState } from 'react'
import { useStorage } from '../../hooks/useStorage'
import { usePlatform } from '../../hooks/usePlatform'
import { logAction } from '../../core/log-backend'

interface UseHomeImportKBOptions {
  refreshKBList: () => Promise<void>
}

export function useHomeImportKB({ refreshKBList }: UseHomeImportKBOptions) {
  const storage = useStorage()
  const platform = usePlatform()
  const [showImportSheet, setShowImportSheet] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')

  const prevShowImportSheet = useRef(false)
  useEffect(() => {
    if (showImportSheet && !prevShowImportSheet.current) {
      logAction('HomePage:导入知识库弹窗:打开', 'HomePage', {})
    } else if (!showImportSheet && prevShowImportSheet.current) {
      logAction('HomePage:导入知识库弹窗:关闭', 'HomePage', { importDir })
    }
    prevShowImportSheet.current = showImportSheet
  }, [showImportSheet, importDir])

  const openImportSheet = () => {
    logAction('点击导入知识库', 'HomePage', {})
    setShowImportSheet(true)
    setImportDir('')
    setImportError('')
  }

  const closeImportSheet = () => {
    setShowImportSheet(false)
  }

  const handleSelectImportDir = async () => {
    logAction('HomePage:点击选择导入文件夹', 'HomePage', {})
    const res = await platform.selectDirectory()
    if (res?.valid) {
      setImportDir(res.nodePath || '')
      setImportError('')
      logAction('HomePage:选择导入文件夹完成', 'HomePage', { selectedPath: res.nodePath })
    } else {
      logAction('HomePage:选择导入文件夹取消', 'HomePage', {})
    }
  }

  const handleImportKB = async () => {
    if (!importDir) {
      setImportError('请先选择一个文件夹')
      return
    }
    setImportError('')
    setImportLoading(true)
    try {
      await storage.importKB(importDir)
      logAction('知识库:导入', 'HomePage', { sourcePath: importDir })
      setShowImportSheet(false)
      setImportDir('')
      await refreshKBList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportError(msg || '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  return {
    showImportSheet,
    importDir,
    importLoading,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportDir,
    handleImportKB,
  }
}
