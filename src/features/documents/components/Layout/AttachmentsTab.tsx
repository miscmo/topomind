import { memo, useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStorage } from '../../../../core/storage'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { logger } from '../../../../core/logger'
import type { AttachmentItem } from '../../../../core/storage'
import { logAction } from '../../../../core/log-backend'
import type { FSBTrashItem } from '../../../../core/fs-backend'

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

const AttachmentItemRow = memo(function AttachmentItemRow({
  item,
  attachmentCardPath,
  onInsert,
  onOpen,
  onShowInFolder,
  onDelete
}: {
  item: AttachmentItem
  attachmentCardPath: string
  onInsert: (item: AttachmentItem, e: React.MouseEvent) => void
  onOpen: (item: AttachmentItem, e: React.MouseEvent) => void
  onShowInFolder: (item: AttachmentItem, e: React.MouseEvent) => void
  onDelete: (item: AttachmentItem, e: React.MouseEvent) => void
}) {
  const storage = useStorage()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const elRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = () => {
    setIsHovering(true)
    if (elRef.current) {
      setRect(elRef.current.getBoundingClientRect())
    }
    if (item.isImage && !previewUrl) {
      hoverTimer.current = window.setTimeout(() => {
        storage.getAttachmentAbsoluteUrl(attachmentCardPath, item.name).then(url => {
          if (url) setPreviewUrl(url)
        }).catch(err => {
          logger.catch('AttachmentItemRow', 'getPreview', err)
        })
      }, 400)
    }
  }

  const handleMouseLeave = () => {
    setIsHovering(false)
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    }
  }, [])

  return (
    <>
      <div 
        ref={elRef}
        className="flex items-center gap-2 p-2 rounded-md select-none transition-colors duration-75 hover:bg-[var(--color-hover-bg)] group relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="text-[18px] flex items-center justify-center w-6 shrink-0 text-[var(--color-text-muted)]">
          {item.isImage ? '🖼️' : '📄'}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="text-[13px] text-[var(--color-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis" title={item.name}>{item.name}</div>
          <div className="text-[11px] text-[var(--color-text-muted)]">
            {(item.size / 1024).toFixed(1)} KB
          </div>
        </div>
        <div className="opacity-0 flex items-center gap-1 group-hover:opacity-100 transition-all duration-75">
          <button
            className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={(e) => onInsert(item, e)}
            title="插入到文档"
          >
            ↵
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={(e) => onOpen(item, e)}
            title="使用系统默认程序打开"
          >
            ↗
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={(e) => onShowInFolder(item, e)}
            title="在文件夹中显示"
          >
            📁
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-danger)]"
            onClick={(e) => onDelete(item, e)}
            title="删除附件"
          >
            ✕
          </button>
        </div>
      </div>
      {item.isImage && isHovering && previewUrl && rect && createPortal(
        <div style={{
          position: 'fixed',
          zIndex: 9999,
          top: Math.min(rect.top, window.innerHeight - 340),
          left: rect.right + 340 > window.innerWidth ? rect.left - 330 : rect.right + 10,
          width: '320px',
          backgroundColor: 'var(--color-bg-float, #fff)',
          border: '1px solid var(--color-border, #e2e8f0)',
          borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          padding: '6px',
          pointerEvents: 'none'
        }}>
          <img src={previewUrl} alt="Preview" style={{ width: '100%', height: 'auto', maxHeight: '320px', objectFit: 'contain', borderRadius: '4px', backgroundColor: 'var(--color-bg, #f8fafc)' }} />
        </div>,
        document.body
      )}
    </>
  )
})

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

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments])

  const handleDelete = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: '删除附件',
      message: `确定要删除附件「${item.name}」吗？该附件会移入全局回收站。如果该附件已在文档中引用，引用将失效。`
    })
    if (!confirmed) return
    
    try {
      setError('')
      await storage.deleteAttachment(attachmentCardPath, item.name)
      await loadAttachments()
      logAction('附件管理:删除', 'AttachmentsTab', { attachmentCardPath, name: item.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleDelete', e)
    }
  }, [attachmentCardPath, confirm, loadAttachments, storage])

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
        logAction('附件管理:上传', 'AttachmentsTab', { attachmentCardPath, count: importedCount })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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

  const handleInsert = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const url = await storage.getAttachmentAbsoluteUrl(attachmentCardPath, item.name)
      if (!url) {
        throw new Error(`无法生成附件访问地址: ${item.name}`)
      }
      window.dispatchEvent(new CustomEvent('insert-attachment', {
        detail: {
          name: item.name,
          attachmentRef: item.path || `_attach/${item.name}`,
          url,
          isImage: item.isImage,
          targetKey: insertTargetKey
        }
      }))
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleInsert', err)
    }
  }, [attachmentCardPath, insertTargetKey, storage])

  const handleOpen = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await storage.openAttachment(attachmentCardPath, item.name)
      logAction('附件管理:系统打开', 'AttachmentsTab', { attachmentCardPath, name: item.name })
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleOpen', err)
    }
  }, [attachmentCardPath, storage])

  const handleShowInFolder = useCallback(async (item: AttachmentItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await storage.showAttachmentInFolder(attachmentCardPath, item.name)
      logAction('附件管理:资源管理器打开', 'AttachmentsTab', { attachmentCardPath, name: item.name })
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleShowInFolder', err)
    }
  }, [attachmentCardPath, storage])

  const isInitialLoading = loading && attachments.length === 0

  if (isInitialLoading) {
    return <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--color-border-subtle)]">
        <button className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-text-muted)] rounded-md text-[13px] cursor-pointer transition-all duration-75 disabled:opacity-60 disabled:cursor-not-allowed hover:not(:disabled):bg-[var(--color-hover-bg)] hover:not(:disabled):border-[var(--color-border-strong)] hover:not(:disabled):text-[var(--color-text-primary)]" onClick={handleUpload} disabled={loading}>
          <span className="text-[16px] font-bold">+</span> 上传附件
        </button>
        {error && <div className="mt-2 rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-danger)]">{error}</div>}
      </div>
      
      {attachments.length === 0 ? (
        <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无附件<br/><span style={{ fontSize: '11px', marginTop: 4, display: 'inline-block' }}>点击上方按钮或拖拽文件到编辑器</span></div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {attachments.map(item => (
            <AttachmentItemRow
              key={item.name}
              item={item}
              attachmentCardPath={attachmentCardPath}
              onInsert={handleInsert}
              onOpen={handleOpen}
              onShowInFolder={handleShowInFolder}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
})
