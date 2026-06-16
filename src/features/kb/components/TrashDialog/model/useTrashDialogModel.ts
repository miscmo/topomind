import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../../../../../core/storage'
import { logger } from '../../../../../core/logger'
import { logAction } from '../../../../../core/log-backend'
import type { FSBTrashItem } from '../../../../../core/fs-backend'
import { useConfirmStore } from '../../../../../shared/ui/ConfirmModal/confirmStore'

export function useTrashDialogModel(visible: boolean, refreshKBList: () => Promise<void>) {
  const storage = useStorage()
  const [items, setItems] = useState<FSBTrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError('')
    try {
      setItems(await storage.listAllTrashItems())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('useTrashDialogModel', 'loadItems', e)
    } finally {
      setLoading(false)
    }
  }, [storage, visible])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleRestore = useCallback(async (item: FSBTrashItem) => {
    const confirmed = await useConfirmStore.getState().open({
      title: '确认恢复',
      message: `确定要恢复 ${item.businessName || item.originalName} 吗？\n恢复后它将回到原来的位置。`
    })
    
    if (!confirmed) return

    setLoading(true)
    setError('')
    try {
      const restoredName = await storage.restoreGlobalTrashItem(item.category!, item.trashName)
      await refreshKBList()
      await loadItems()
      logAction('回收站:恢复项目', 'useTrashDialogModel', { trashName: item.trashName, restoredName, category: item.category })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('useTrashDialogModel', 'handleRestore', e)
    } finally {
      setLoading(false)
    }
  }, [loadItems, refreshKBList, storage])

  const handleClear = useCallback(async () => {
    if (items.length === 0) return
    const confirmed = await useConfirmStore.getState().open({
      title: '清空回收站',
      message: '确定要永久清空回收站中的所有项目吗（包括知识库、节点、文档、附件等）？该操作不可恢复。'
    })
    if (!confirmed) return
    
    setLoading(true)
    setError('')
    try {
      await storage.clearAllTrashItems()
      setItems([])
      logAction('回收站:清空全部', 'useTrashDialogModel', { count: items.length })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('useTrashDialogModel', 'handleClear', e)
    } finally {
      setLoading(false)
    }
  }, [items.length, storage])

  return {
    items,
    loading,
    error,
    handleRestore,
    handleClear
  }
}
