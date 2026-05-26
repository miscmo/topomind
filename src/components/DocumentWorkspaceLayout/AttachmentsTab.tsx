import { memo, useEffect, useState, useCallback } from 'react'
import { useStorage } from '../../core/storage'
import { useConfirmStore } from '../../stores/confirmStore'
import { logger } from '../../core/logger'
import type { AttachmentItem } from '../../core/storage'
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
}

export const AttachmentsTab = memo(function AttachmentsTab({ attachmentCardPath }: AttachmentsTabProps) {
  const storage = useStorage()
  const confirm = useConfirmStore(s => s.open)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadAttachments = useCallback(async () => {
    if (!attachmentCardPath) return
    try {
      setLoading(true)
      const list = await storage.listAttachments(attachmentCardPath)
      setAttachments(list)
    } catch (e) {
      logger.catch('AttachmentsTab', 'loadAttachments', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, storage])

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments])

  const handleDelete = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: '删除附件',
      message: `确定要删除附件「${item.name}」吗？该操作不可恢复。如果该附件已在文档中引用，引用将失效。`
    })
    if (!confirmed) return
    
    try {
      await storage.deleteAttachment(attachmentCardPath, item.name)
      await loadAttachments()
      logAction('附件管理:删除', 'AttachmentsTab', { attachmentCardPath, name: item.name })
    } catch (e) {
      logger.catch('AttachmentsTab', 'handleDelete', e)
    }
  }, [attachmentCardPath, confirm, loadAttachments, storage])

  const handleUpload = useCallback(async () => {
    try {
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
        logAction('附件管理:上传', 'AttachmentsTab', { attachmentCardPath, count: importedCount })
      }
    } catch (e) {
      logger.catch('AttachmentsTab', 'handleUpload', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardPath, loadAttachments, storage])

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

  if (loading && attachments.length === 0) {
    return <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[#f1f5f9] !border-[var(--color-border-subtle)]">
        <button className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-dashed border-[#cbd5e1] !border-[var(--color-border-strong)] bg-[#f8fafc] !bg-[var(--color-bg)] text-[#475569] !text-[var(--color-text-muted)] rounded-md text-[13px] cursor-pointer transition-all duration-75 disabled:opacity-60 disabled:cursor-not-allowed hover:not(:disabled):bg-[#f1f5f9] hover:not(:disabled):border-[#94a3b8] hover:not(:disabled):!border-[var(--color-border-strong)] hover:not(:disabled):text-[#334155] hover:not(:disabled):!text-[var(--color-text-primary)]" onClick={handleUpload} disabled={loading}>
          <span className="text-[16px] font-bold">+</span> 上传附件
        </button>
      </div>
      
      {attachments.length === 0 ? (
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
                <div className="text-[13px] text-[#334155] !text-[var(--color-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis">{item.name}</div>
                <div className="text-[11px] text-[#94a3b8] !text-[var(--color-text-muted)]">
                  {(item.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button 
                className="opacity-0 w-6 h-6 flex items-center justify-center border-none bg-transparent text-[#94a3b8] !text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] group-hover:opacity-100 hover:!bg-[#fee2e2] hover:!text-[#ef4444] hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]" 
                onClick={(e) => handleDelete(item, e)}
                title="删除附件"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
