import { useState } from 'react'
import { useStorage } from '../../../core/storage'
import { usePlatform } from '../../../hooks/usePlatform'
import { logAction } from '../../../core/log-backend'
import { recordStep } from '../../../core/traceBuffer'
import { PERFORMANCE_METRICS, measurePerformance } from '../../../core/performance-log'

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
  const [selectingImportDir, setSelectingImportDir] = useState(false)

  const openImportSheet = () => {
    // P7：打开弹窗是过程痕迹，落盘事实只在导入成功/失败时写 1 条。
    recordStep({ name: 'kb.import.open_dialog', outcome: 'opened' })
    logAction('kb.import_dialog', 'HomePage', {})
    setShowImportSheet(true)
    setImportDir('')
    setImportError('')
  }

  const closeImportSheet = () => {
    logAction('kb.import_dialog', 'HomePage', { importDir })
    setShowImportSheet(false)
  }

  const handleSelectImportDir = async () => {
    if (importLoading || selectingImportDir) return
    recordStep({ name: 'kb.import.select_dir', outcome: 'start' })
    setSelectingImportDir(true)
    try {
      const res = await platform.selectDirectory()
      if (res?.valid) {
        setImportDir(res.nodePath || '')
        setImportError('')
        recordStep({ name: 'kb.import.select_dir', outcome: 'selected', params: { selectedPath: res.nodePath } })
      } else {
        recordStep({ name: 'kb.import.select_dir', outcome: 'cancelled' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportError(msg || '选择文件夹失败')
    } finally {
      setSelectingImportDir(false)
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
      await measurePerformance(PERFORMANCE_METRICS.kbImport, () => storage.importKB(importDir), {
        module: 'HomePage',
        params: { sourcePath: importDir },
      })
      // P7：kb.import 的唯一落盘产生点 —— 导入成功这一事实（用户意图 + 结果）。
      logAction('kb.import', 'HomePage', { sourcePath: importDir }, { kind: 'intent' })
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
    selectingImportDir,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportDir,
    handleImportKB,
  }
}
