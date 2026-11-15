import { memo, useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, ExternalLink, FileText, FolderOpen, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { logger } from '../../../../core/logger'
import type { AttachmentItem } from '../../../../core/storage'
import { logAction } from '../../../../core/log-backend'
import { PERFORMANCE_METRICS, startPerformanceSpan } from '../../../../core/performance-log'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { PANEL_LIST, PanelListAction } from '../../../../shared/ui/panelList'

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

  const TypeIcon = item.isImage ? ImageIcon : FileText

  return (
    <>
      <div
        ref={elRef}
        className={`${PANEL_LIST.row} !items-start !gap-2`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <TypeIcon className={`mt-[2px] ${item.isImage ? PANEL_LIST.iconActive : PANEL_LIST.icon}`} />
        <div className="min-w-0 flex-1">
          <div className={`${PANEL_LIST.rowTitle} truncate`} title={item.name}>{item.name}</div>
          <div className={PANEL_LIST.rowMeta}>
            {(item.size / 1024).toFixed(1)} KB · {item.isImage ? '图片' : '文件'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <PanelListAction title="插入到文档" onClick={(e) => onInsert(item, e)}>
            <CornerDownLeft className="h-3.5 w-3.5" />
          </PanelListAction>
          <PanelListAction title="使用系统默认程序打开" onClick={(e) => onOpen(item, e)}>
            <ExternalLink className="h-3.5 w-3.5" />
          </PanelListAction>
          <PanelListAction title="在文件夹中显示" onClick={(e) => onShowInFolder(item, e)}>
            <FolderOpen className="h-3.5 w-3.5" />
          </PanelListAction>
          <PanelListAction
            title="删除附件"
            className="hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]"
            onClick={(e) => onDelete(item, e)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </PanelListAction>
        </div>
      </div>
      {item.isImage && isHovering && previewUrl && rect && createPortal(
        <div style={{
          position: 'fixed',
          zIndex: 9999,
          top: Math.min(rect.top, window.innerHeight - 340),
          left: rect.right + 340 > window.innerWidth ? rect.left - 330 : rect.right + 10,
          width: '320px',
          backgroundColor: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border-light)',
          borderRadius: '8px',
          boxShadow: 'var(--shadow-lg)',
          padding: '6px',
          pointerEvents: 'none'
        }}>
          <img src={previewUrl} alt="Preview" style={{ width: '100%', height: 'auto', maxHeight: '320px', objectFit: 'contain', borderRadius: '4px', backgroundColor: 'var(--color-bg-muted)' }} />
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
    let perfSpan: ReturnType<typeof startPerformanceSpan> | null = null
    try {
      setError('')
      const filePaths = await window.electronAPI?.invoke('app:openFileDialog', {
        properties: ['openFile', 'multiSelections'],
        title: '选择要上传的附件'
      }) as string[] | undefined

      if (filePaths && filePaths.length > 0) {
        setLoading(true)
        perfSpan = startPerformanceSpan(PERFORMANCE_METRICS.attachmentUpload, {
          module: 'AttachmentsTab',
          params: { attachmentCardPath, requestedCount: filePaths.length },
        })
        let importedCount = 0
        for (const filePath of filePaths) {
          const originalName = filePath.split(/[/\\]/).pop() || 'attachment'
          const targetFileName = generateUniqueFileName(originalName)
          await storage.importAttachment(attachmentCardPath, filePath, targetFileName)
          importedCount++
        }
        await loadAttachments()
        logAction('附件管理:上传', 'AttachmentsTab', { attachmentCardPath, count: importedCount })
        perfSpan.end({ count: importedCount })
        perfSpan = null
      }
    } catch (e) {
      perfSpan?.fail(e)
      perfSpan = null
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
    return <div className={PANEL_LIST.empty}>加载中...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className={PANEL_LIST.header}>
        <Paperclip className={PANEL_LIST.headerIcon} />
        <span className={PANEL_LIST.title}>附件</span>
        <span className={PANEL_LIST.count}>{attachments.length} 个</span>
        <button
          type="button"
          className={PANEL_LIST.addButton}
          onClick={handleUpload}
          disabled={loading}
          title="上传附件"
        >
          <Upload className="h-3.5 w-3.5" /> 上传附件
        </button>
      </div>
      {error && (
        <div className="mx-2 mt-1.5 rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-danger)]">{error}</div>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          className="flex-1 justify-center"
          size="sm"
          icon={<Paperclip className="h-4 w-4" />}
          title="暂无附件"
          description="点击上方上传，或拖拽文件到编辑器"
        />
      ) : (
        <div className={`${PANEL_LIST.body} flex flex-col gap-0.5`}>
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
      <div className={PANEL_LIST.footer}>拖拽文件到编辑器也可自动上传</div>
    </div>
  )
})
