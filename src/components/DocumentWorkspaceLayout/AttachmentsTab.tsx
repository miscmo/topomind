import { memo, useEffect, useState, useCallback } from 'react'
import { useStorage } from '../../core/storage'
import { useConfirmStore } from '../../stores/confirmStore'
import { logger } from '../../core/logger'
import type { AttachmentItem } from '../../core/storage'
import type { FSBTrashItem } from '../../core/fs-backend'
import { logAction } from '../../core/log-backend'

export function generateUniqueFileName(originalName: string): string {
  const uuid = crypto.randomUUID().split('-')[0]
  const lastDot = originalName.lastIndexOf('.')
  if (lastDot !== -1 && lastDot !== 0) {
    const name = originalName.substring(0, lastDot)
    const ext = originalName.substring(lastDot)
    return `${name}_${uuid}${ext}`
  }
  return `${originalName}_${uuid}`
}

interface AttachmentsTabProps {
  attachmentCardPath: string
  insertTargetKey?: string
}

export const AttachmentsTab = memo(function AttachmentsTab({ attachmentCardPath, insertTargetKey }: AttachmentsTabProps) {
  const storage = useStorage()
  const confirm = useConfirmStore(s => s.open)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [trashAttachments, setTrashAttachments] = useState<FSBTrashItem[]>([])
  const [viewMode, setViewMode] = useState<'active' | 'trash'>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAttachments = useCallback(async () => {
    if (!attachmentCardPath) return
    try {
      setLoading(true)
      setError('')
      const list = await storage.listAttachments(attachmentCardPath)
      setAttachments(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'loadAttachments', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, storage])

  const loadTrashAttachments = useCallback(async () => {
    if (!attachmentCardPath) return
    try {
      setLoading(true)
      setError('')
      const list = await storage.listTrashAttachments(attachmentCardPath)
      setTrashAttachments(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'loadTrashAttachments', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, storage])

  useEffect(() => {
    if (viewMode === 'trash') {
      void loadTrashAttachments()
    } else {
      void loadAttachments()
    }
  }, [loadAttachments, loadTrashAttachments, viewMode])

  const handleDelete = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: '删除附件',
      message: `确定要删除附件「${item.name}」吗？该附件会移入回收站。如果该附件已在文档中引用，引用将失效。`
    })
    if (!confirmed) return
    
    try {
      setError('')
      await storage.deleteAttachment(attachmentCardPath, item.name)
      await loadAttachments()
      await loadTrashAttachments()
      logAction('附件管理:删除', 'AttachmentsTab', { attachmentCardPath, name: item.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleDelete', e)
    }
  }, [attachmentCardPath, confirm, loadAttachments, loadTrashAttachments, storage])

  const handleRestore = useCallback(async (item: FSBTrashItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      setError('')
      await storage.restoreTrashAttachment(attachmentCardPath, item.trashName)
      await loadAttachments()
      await loadTrashAttachments()
      logAction('附件管理:恢复', 'AttachmentsTab', { attachmentCardPath, trashName: item.trashName, originalName: item.originalName })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      logger.catch('AttachmentsTab', 'handleRestore', err)
    }
  }, [attachmentCardPath, loadAttachments, loadTrashAttachments, storage])

  const handleClearTrash = useCallback(async () => {
    if (trashAttachments.length === 0) return
    const confirmed = await confirm({
      title: '清空附件回收站',
      message: '确定要永久清空当前节点的附件回收站吗？该操作不可恢复。'
    })
    if (!confirmed) return
    try {
      setLoading(true)
      setError('')
      await storage.clearTrashAttachments(attachmentCardPath)
      await loadTrashAttachments()
      logAction('附件管理:清空回收站', 'AttachmentsTab', { attachmentCardPath, count: trashAttachments.length })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleClearTrash', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, confirm, loadTrashAttachments, storage, trashAttachments.length])

  const handleUpload = useCallback(async () => {
    try {
      setError('')
      const filePaths = await window.electronAPI?.invoke('app:openFileDialog', {
        properties: ['openFile', 'multiSelections'],
        title: '选择要上传的附件'
      }) as string[] | undefined
      
      if (filePaths && filePaths.length > 0) {
        setLoading(true)
        let importedCount = 0
        for (const filePath of filePaths) {
          const originalName = filePath.split(/[/\\]/).pop() || 'attachment'
          const targetFileName = generateUniqueFileName(originalName)
          await storage.importAttachment(attachmentCardPath, filePath, targetFileName)
          importedCount++
        }
        await loadAttachments()
        await loadTrashAttachments()
        logAction('附件管理:上传', 'AttachmentsTab', { attachmentCardPath, count: importedCount })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleUpload', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, loadAttachments, loadTrashAttachments, storage])

  useEffect(() => {
    // expose refresh method
    const handleRefresh = () => {
      void loadAttachments()
    }
    window.addEventListener('document-attachment-uploaded', handleRefresh)
    return () => {
      window.removeEventListener('document-attachment-uploaded', handleRefresh)
    }
  }, [loadAttachments])

  const handleInsert = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const url = await storage.getAttachmentAbsoluteUrl(attachmentCardPath, item.name)
      window.dispatchEvent(new CustomEvent('insert-attachment', {
        detail: {
          name: item.name,
          url,
          isImage: item.isImage,
          targetKey: insertTargetKey
        }
      }))
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleInsert', err)
    }
  }, [attachmentCardPath, insertTargetKey, storage])

  const shownTrash = viewMode === 'trash'
  const isInitialLoading = loading && attachments.length === 0 && trashAttachments.length === 0

  if (isInitialLoading) {
    return <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[#f1f5f9] !border-[var(--color-border-subtle)]">
        <div className="flex gap-1 mb-2">
          <button className={`flex-1 py-1.5 px-2 rounded-md text-[12px] border transition-colors ${!shownTrash ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] border-[var(--color-primary-soft)]' : 'bg-transparent text-[var(--color-text-muted)] border-[var(--color-border-light)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('active')} disabled={loading}>当前附件</button>
          <button className={`flex-1 py-1.5 px-2 rounded-md text-[12px] border transition-colors ${shownTrash ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] border-[var(--color-primary-soft)]' : 'bg-transparent text-[var(--color-text-muted)] border-[var(--color-border-light)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('trash')} disabled={loading}>回收站</button>
        </div>
        {!shownTrash && (
          <button className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-dashed border-[#cbd5e1] !border-[var(--color-border-strong)] bg-[#f8fafc] !bg-[var(--color-bg)] text-[#475569] !text-[var(--color-text-muted)] rounded-md text-[13px] cursor-pointer transition-all duration-75 disabled:opacity-60 disabled:cursor-not-allowed hover:not(:disabled):bg-[#f1f5f9] hover:not(:disabled):border-[#94a3b8] hover:not(:disabled):!border-[var(--color-border-strong)] hover:not(:disabled):text-[#334155] hover:not(:disabled):!text-[var(--color-text-primary)]" onClick={handleUpload} disabled={loading}>
            <span className="text-[16px] font-bold">+</span> 上传附件
          </button>
        )}
        {shownTrash && trashAttachments.length > 0 && (
          <button className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-[var(--color-danger)] bg-transparent text-[var(--color-danger)] rounded-md text-[13px] cursor-pointer transition-all duration-75 disabled:opacity-60 disabled:cursor-not-allowed hover:not(:disabled):bg-[var(--color-danger-soft)]" onClick={() => void handleClearTrash()} disabled={loading}>
            清空附件回收站
          </button>
        )}
        {error && <div className="mt-2 rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-danger)]">{error}</div>}
      </div>
      
      {shownTrash ? (
        trashAttachments.length === 0 ? (
          <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">附件回收站为空</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {trashAttachments.map(item => (
              <div key={item.trashName} className="flex items-center gap-2 p-2 rounded-md select-none transition-colors duration-75 hover:bg-[#f1f5f9] hover:!bg-[var(--color-hover-bg)] group">
                <div className="text-[18px] flex items-center justify-center w-6 shrink-0 text-[#64748b] !text-[var(--color-text-muted)]">🗑️</div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="text-[13px] text-[#334155] !text-[var(--color-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis" title={item.originalName}>{item.originalName}</div>
                  <div className="text-[11px] text-[#94a3b8] !text-[var(--color-text-muted)]">{new Date(item.deletedAt).toLocaleString('zh-CN')}</div>
                </div>
                <button
                  className="px-2 h-6 flex items-center justify-center border border-[var(--color-border)] bg-transparent text-[#64748b] !text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[12px] hover:!bg-[var(--color-hover-bg)] hover:!text-[var(--color-text-primary)]"
                  onClick={(e) => handleRestore(item, e)}
                  title="恢复附件"
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        )
      ) : attachments.length === 0 ? (
        <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无附件<br/><span style={{ fontSize: '11px', marginTop: 4, display: 'inline-block' }}>点击上方按钮或拖拽文件到编辑器</span></div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {attachments.map(item => (
            <div 
              key={item.name} 
              className="flex items-center gap-2 p-2 rounded-md select-none transition-colors duration-75 hover:bg-[#f1f5f9] hover:!bg-[var(--color-hover-bg)] group"
            >
              <div className="text-[18px] flex items-center justify-center w-6 shrink-0 text-[#64748b] !text-[var(--color-text-muted)]">
                {item.isImage ? '🖼️' : '📄'}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <div className="text-[13px] text-[#334155] !text-[var(--color-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis" title={item.name}>{item.name}</div>
                <div className="text-[11px] text-[#94a3b8] !text-[var(--color-text-muted)]">
                  {(item.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <div className="opacity-0 flex items-center gap-1 group-hover:opacity-100 transition-all duration-75">
                <button
                  className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[#94a3b8] !text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:!bg-[#e2e8f0] hover:!text-[#0f172a] hover:!bg-[var(--color-hover-bg)] hover:!text-[var(--color-text-primary)]"
                  onClick={(e) => handleInsert(item, e)}
                  title="插入到文档"
                >
                  ↵
                </button>
                <button
                  className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[#94a3b8] !text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:!bg-[#fee2e2] hover:!text-[#ef4444] hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]"
                  onClick={(e) => handleDelete(item, e)}
                  title="删除附件"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
