import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useStorage } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import type { FSBTrashItem } from '../../core/fs-backend'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../ui/modal'

interface TrashDialogProps {
  visible: boolean
  onClose: () => void
  refreshKBList: () => Promise<void>
}

function formatDeletedAt(value: number) {
  if (!Number.isFinite(value)) return '未知时间'
  return new Date(value).toLocaleString('zh-CN')
}

export function TrashDialog({ visible, onClose, refreshKBList }: TrashDialogProps) {
  const storage = useStorage()
  const [items, setItems] = useState<FSBTrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError('')
    try {
      setItems(await storage.listTrashKBs())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('TrashDialog', 'loadItems', e)
    } finally {
      setLoading(false)
    }
  }, [storage, visible])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleRestore = useCallback(async (item: FSBTrashItem) => {
    setLoading(true)
    setError('')
    try {
      const restoredName = await storage.restoreTrashKB(item.trashName)
      await refreshKBList()
      await loadItems()
      logAction('回收站:恢复知识库', 'TrashDialog', { trashName: item.trashName, restoredName })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('TrashDialog', 'handleRestore', e)
    } finally {
      setLoading(false)
    }
  }, [loadItems, refreshKBList, storage])

  const handleClear = useCallback(async () => {
    if (items.length === 0) return
    const confirmed = window.confirm('确定要永久清空工作区回收站中的知识库和已删除节点吗？该操作不可恢复。')
    if (!confirmed) return
    setLoading(true)
    setError('')
    try {
      await storage.clearTrashKBs()
      setItems([])
      logAction('回收站:清空知识库', 'TrashDialog', { count: items.length })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('TrashDialog', 'handleClear', e)
    } finally {
      setLoading(false)
    }
  }, [items.length, storage])

  if (!visible) return null

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`w-[560px] max-w-[92%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>知识库回收站</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div className="mb-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</div>}
          <div className="mb-4 text-[13px] text-[var(--color-text-secondary)]">这里显示已删除的知识库。清空时也会一并永久清理已删除节点占用的空间。文档和附件可在对应节点内的回收站中恢复或清空。恢复时如果原名称已存在，会自动添加后缀避免覆盖。</div>
          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[var(--color-border-light)]">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">加载中...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">回收站为空</div>
            ) : (
              items.map((item) => (
                <div key={item.trashName} className="flex items-center justify-between gap-4 border-b border-[var(--color-border-light)] p-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-[var(--color-text-primary)]" title={item.originalName}>{item.originalName}</div>
                    <div className="mt-1 truncate text-[12px] text-[var(--color-text-muted)]" title={item.originalPath || item.trashName}>删除时间：{formatDeletedAt(item.deletedAt)}</div>
                  </div>
                  <button
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleRestore(item)}
                    disabled={loading}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    恢复
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="p-[14px_24px] bg-[var(--color-bg)] border-t border-[var(--color-border-light)] flex justify-between gap-2.5">
          <button className="inline-flex items-center rounded-lg border border-[var(--color-danger)] bg-transparent px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void handleClear()} disabled={loading || items.length === 0}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            清空回收站
          </button>
          <button className="rounded-lg border-none bg-[var(--color-hover-bg)] px-5 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose} disabled={loading}>关闭</button>
        </div>
      </div>
    </div>
  )
}
