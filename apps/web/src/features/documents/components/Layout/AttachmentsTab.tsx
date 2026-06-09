import { memo, useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStorage, type AttachmentUploadSyncContext, type TrashItem } from '../../../../core/storage'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { logger } from '../../../../core/logger'
import type { AttachmentItem } from '../../../../core/storage'
import { logAction } from '../../../../core/log-backend'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../../../../application/cloud/events'
import { getCloudAttachmentLocalUrl, openCloudAttachment } from '../../../../core/cloud-attachment-cache'
import { maybeCreateAttachmentUploadTicket, normalizeAttachmentMimeType } from '../../../../core/attachment-upload-ticket'
import { LocalDB } from '../../../../core/localdb-backend'
import { useWorkspaceStore } from '../../../../stores/workspaceStore'
import { useSelectedNodeId } from '../../../../stores/graphStore'
import { topoDocumentIdFromKey } from '../../types/documentTypes'
import type { LocalAttachmentRecord } from '../../../../types/local-sync'

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

async function readFileAsBase64Data(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const [, base64Data = ''] = result.split(',', 2)
      if (!base64Data) {
        reject(new Error(`读取附件失败: ${file.name}`))
        return
      }
      resolve(base64Data)
    }
    reader.onerror = () => reject(reader.error ?? new Error(`读取附件失败: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

const AttachmentItemRow = memo(function AttachmentItemRow({
  item,
  onResolvePreviewUrl,
  onInsert,
  onOpen,
  onDelete
}: {
  item: AttachmentListItem
  onResolvePreviewUrl: (item: AttachmentListItem) => Promise<string | null>
  onInsert: (item: AttachmentListItem, e: React.MouseEvent) => void
  onOpen: (item: AttachmentListItem, e: React.MouseEvent) => void
  onDelete: (item: AttachmentListItem, e: React.MouseEvent) => void
}) {
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
        onResolvePreviewUrl(item).then(url => {
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

interface AttachmentListItem extends AttachmentItem {
  attachmentId?: string
  source: 'local' | 'cloud'
}

interface AttachmentTrashItem {
  id: string
  source: 'local' | 'cloud'
  originalName: string
  deletedAt: string
  trashName?: string
  attachmentId?: string
}

function isImageAttachment(record: { mimeType?: string | null; fileName?: string | null }) {
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim().toLowerCase() : ''
  if (mimeType.startsWith('image/')) {
    return true
  }
  const extension = String(record.fileName || '').split('.').pop()?.trim().toLowerCase() || ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(extension)
}

function mapCloudAttachmentToItem(record: LocalAttachmentRecord): AttachmentListItem {
  const mtime = Date.parse(record.updatedAt || record.createdAt || '') || Date.now()
  return {
    attachmentId: record.id,
    source: 'cloud',
    name: record.fileName,
    attachmentRef: `_attach/${record.fileName}`,
    isImage: isImageAttachment(record),
    size: record.sizeBytes,
    mtime,
  }
}

function mapCloudAttachmentToTrashItem(record: LocalAttachmentRecord): AttachmentTrashItem {
  return {
    id: record.id,
    source: 'cloud',
    originalName: record.fileName,
    deletedAt: record.deletedAt || record.updatedAt || record.createdAt,
    attachmentId: record.id,
  }
}

function mapLocalTrashAttachmentToItem(item: TrashItem): AttachmentTrashItem {
  return {
    id: item.trashName,
    source: 'local',
    originalName: item.originalName,
    deletedAt: new Date(item.deletedAt).toISOString(),
    trashName: item.trashName,
  }
}

interface AttachmentsTabProps {
  attachmentCardRef: string
  insertTargetKey?: string
}

export const AttachmentsTab = memo(function AttachmentsTab({ attachmentCardRef, insertTargetKey }: AttachmentsTabProps) {
  const storage = useStorage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const selectedNodeId = useSelectedNodeId()
  const isCloudMode = Boolean(currentWorkspaceId && selectedNodeId)
  const confirm = useConfirmStore(s => s.open)
  const [attachments, setAttachments] = useState<AttachmentListItem[]>([])
  const [trashAttachments, setTrashAttachments] = useState<AttachmentTrashItem[]>([])
  const [viewMode, setViewMode] = useState<'active' | 'trash'>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const attachmentSyncContext: AttachmentUploadSyncContext | undefined =
    currentWorkspaceId && selectedNodeId
      ? {
          workspaceId: currentWorkspaceId,
          cardId: selectedNodeId,
          documentId: topoDocumentIdFromKey(insertTargetKey || ''),
        }
      : undefined

  const loadAttachments = useCallback(async () => {
    if (!attachmentCardRef) return
    try {
      setLoading(true)
      setError('')
      if (currentWorkspaceId && selectedNodeId) {
        const list = await LocalDB.listAttachmentsByCard(currentWorkspaceId, selectedNodeId)
        setAttachments(list.filter((item) => !item.deletedAt).map(mapCloudAttachmentToItem))
      } else {
        const list = await storage.listAttachments(attachmentCardRef)
        setAttachments(list.map((item) => ({ ...item, source: 'local' as const })))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'loadAttachments', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardRef, currentWorkspaceId, selectedNodeId, storage])

  const loadTrashAttachments = useCallback(async () => {
    if (!attachmentCardRef) return
    try {
      setLoading(true)
      setError('')
      if (currentWorkspaceId && selectedNodeId) {
        const list = await LocalDB.listAttachmentsByCard(currentWorkspaceId, selectedNodeId)
        setTrashAttachments(
          list
            .filter((item) => Boolean(item.deletedAt))
            .map(mapCloudAttachmentToTrashItem)
            .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)),
        )
        return
      }
      const list = await storage.listTrashAttachments(attachmentCardRef)
      setTrashAttachments(list.map(mapLocalTrashAttachmentToItem))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'loadTrashAttachments', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardRef, currentWorkspaceId, selectedNodeId, storage])

  useEffect(() => {
    if (viewMode === 'trash') {
      void loadTrashAttachments()
    } else {
      void loadAttachments()
    }
  }, [loadAttachments, loadTrashAttachments, viewMode])

  const handleDelete = useCallback(async (item: AttachmentListItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: '删除附件',
      message: `确定要删除附件「${item.name}」吗？该附件会移入回收站。如果该附件已在文档中引用，引用将失效。`
    })
    if (!confirmed) return
    
    try {
      setError('')
      if (isCloudMode) {
        if (!item.attachmentId) {
          throw new Error(`云端附件缺少必要标识: ${item.name}`)
        }
        await LocalDB.deleteAttachment({ attachmentId: item.attachmentId })
      } else {
        await storage.deleteAttachment(attachmentCardRef, item.name)
      }
      await loadAttachments()
      await loadTrashAttachments()
      logAction('附件管理:删除', 'AttachmentsTab', { attachmentCardRef, name: item.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleDelete', e)
    }
  }, [attachmentCardRef, confirm, isCloudMode, loadAttachments, loadTrashAttachments, storage])

  const handleRestore = useCallback(async (item: AttachmentTrashItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      setError('')
      if (isCloudMode) {
        if (!item.attachmentId) {
          throw new Error(`云端附件缺少必要标识: ${item.originalName}`)
        }
        await LocalDB.restoreAttachment({ attachmentId: item.attachmentId })
      } else {
        if (!item.trashName) {
          throw new Error(`本地回收站附件缺少 trashName: ${item.originalName}`)
        }
        await storage.restoreTrashAttachment(attachmentCardRef, item.trashName)
      }
      await loadAttachments()
      await loadTrashAttachments()
      setViewMode('active')
      logAction('附件管理:恢复', 'AttachmentsTab', {
        attachmentCardRef,
        trashName: item.trashName,
        attachmentId: item.attachmentId,
        originalName: item.originalName,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      logger.catch('AttachmentsTab', 'handleRestore', err)
    }
  }, [attachmentCardRef, isCloudMode, loadAttachments, loadTrashAttachments, storage])

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
      if (isCloudMode) {
        for (const item of trashAttachments) {
          if (!item.attachmentId) {
            throw new Error(`云端附件缺少必要标识: ${item.originalName}`)
          }
          await LocalDB.purgeAttachment({ attachmentId: item.attachmentId })
        }
      } else {
        await storage.clearTrashAttachments(attachmentCardRef)
      }
      await loadTrashAttachments()
      logAction('附件管理:清空回收站', 'AttachmentsTab', { attachmentCardRef, count: trashAttachments.length })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'handleClearTrash', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardRef, confirm, isCloudMode, loadTrashAttachments, storage, trashAttachments.length])

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return
    }
    try {
      setError('')
      setLoading(true)
      let importedCount = 0
      for (const file of files) {
        const targetFileName = generateUniqueFileName(file.name || 'attachment')
        const uploadTicketJson = await maybeCreateAttachmentUploadTicket({
          syncContext: attachmentSyncContext,
          fileName: targetFileName,
          mimeType: normalizeAttachmentMimeType(file.type, targetFileName),
          sizeBytes: file.size,
        })
        const base64Data = await readFileAsBase64Data(file)
        await storage.writeAttachmentBase64(
          attachmentCardRef,
          targetFileName,
          normalizeAttachmentMimeType(file.type, targetFileName),
          base64Data,
          attachmentSyncContext,
          uploadTicketJson,
        )
        importedCount++
      }
      await loadAttachments()
      await loadTrashAttachments()
      logAction('附件管理:上传', 'AttachmentsTab', { attachmentCardRef, count: importedCount })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.catch('AttachmentsTab', 'uploadFiles', e)
    } finally {
      setLoading(false)
    }
  }, [attachmentCardRef, attachmentSyncContext, loadAttachments, loadTrashAttachments, storage])

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await uploadFiles(files)
  }, [uploadFiles])

  useEffect(() => {
    const handleRefresh = () => {
      if (viewMode === 'trash') {
        void loadTrashAttachments()
      } else {
        void loadAttachments()
      }
    }
    window.addEventListener('document-attachment-uploaded', handleRefresh)
    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleRefresh)
    return () => {
      window.removeEventListener('document-attachment-uploaded', handleRefresh)
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleRefresh)
    }
  }, [loadAttachments, loadTrashAttachments, viewMode])

  const resolveAttachmentUrl = useCallback(async (item: AttachmentListItem) => {
    if (item.source === 'cloud') {
      if (!currentWorkspaceId || !item.attachmentId) {
        return null
      }
      return getCloudAttachmentLocalUrl({
        workspaceId: currentWorkspaceId,
        attachmentId: item.attachmentId,
        fileName: item.name,
      })
    }
    return storage.getAttachmentAbsoluteUrl(attachmentCardRef, item.name)
  }, [attachmentCardRef, currentWorkspaceId, storage])

  const handleInsert = useCallback(async (item: AttachmentListItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const url = await resolveAttachmentUrl(item)
      if (!url) {
        throw new Error(`无法生成附件访问地址: ${item.name}`)
      }
      window.dispatchEvent(new CustomEvent('insert-attachment', {
        detail: {
          name: item.name,
          attachmentRef: item.attachmentRef,
          url,
          isImage: item.isImage,
          targetKey: insertTargetKey
        }
      }))
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleInsert', err)
    }
  }, [insertTargetKey, resolveAttachmentUrl])

  const handleOpen = useCallback(async (item: AttachmentListItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (item.source === 'cloud') {
        if (!currentWorkspaceId || !item.attachmentId) {
          throw new Error('云端附件缺少必要标识')
        }
        await openCloudAttachment({
          workspaceId: currentWorkspaceId,
          attachmentId: item.attachmentId,
          fileName: item.name,
        })
      } else {
        await storage.openAttachment(attachmentCardRef, item.name)
      }
      logAction('附件管理:系统打开', 'AttachmentsTab', { attachmentCardRef, name: item.name })
    } catch (err) {
      logger.catch('AttachmentsTab', 'handleOpen', err)
    }
  }, [attachmentCardRef, currentWorkspaceId, storage])

  const shownTrash = viewMode === 'trash'
  const isInitialLoading = loading && attachments.length === 0 && trashAttachments.length === 0

  if (isInitialLoading) {
    return <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--color-border-subtle)]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelection}
        />
        <div className="flex gap-1 mb-2">
          <button className={`flex-1 py-1.5 px-2 rounded-md text-[12px] border transition-colors ${!shownTrash ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] border-[var(--color-primary-soft)]' : 'bg-transparent text-[var(--color-text-muted)] border-[var(--color-border-light)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('active')} disabled={loading}>当前附件</button>
          <button className={`flex-1 py-1.5 px-2 rounded-md text-[12px] border transition-colors ${shownTrash ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] border-[var(--color-primary-soft)]' : 'bg-transparent text-[var(--color-text-muted)] border-[var(--color-border-light)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('trash')} disabled={loading}>回收站</button>
        </div>
        {isCloudMode && (
          <div className="mb-2 rounded-md bg-[var(--color-primary-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-primary)]">
            云端模式下当前已支持附件查看、插入、删除、恢复、清空回收站，以及下载到本地缓存后打开；相关变更会进入本地同步队列。
          </div>
        )}
        {!shownTrash && (
          <button className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-text-muted)] rounded-md text-[13px] cursor-pointer transition-all duration-75 disabled:opacity-60 disabled:cursor-not-allowed hover:not(:disabled):bg-[var(--color-hover-bg)] hover:not(:disabled):border-[var(--color-border-strong)] hover:not(:disabled):text-[var(--color-text-primary)]" onClick={handleUpload} disabled={loading}>
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
          <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">附件回收站为空</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {trashAttachments.map(item => (
              <div key={item.id} className="flex items-center gap-2 p-2 rounded-md select-none transition-colors duration-75 hover:bg-[var(--color-hover-bg)] group">
                <div className="text-[18px] flex items-center justify-center w-6 shrink-0 text-[var(--color-text-muted)]">🗑️</div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="text-[13px] text-[var(--color-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis" title={item.originalName}>{item.originalName}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">{new Date(item.deletedAt).toLocaleString('zh-CN')}</div>
                </div>
                <button
                  className="px-2 h-6 flex items-center justify-center border border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] rounded cursor-pointer transition-all duration-75 text-[12px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
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
        <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无附件<br/><span style={{ fontSize: '11px', marginTop: 4, display: 'inline-block' }}>点击上方按钮或拖拽文件到编辑器</span></div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {attachments.map(item => (
            <AttachmentItemRow
              key={item.attachmentId || item.attachmentRef || item.name}
              item={item}
              onResolvePreviewUrl={resolveAttachmentUrl}
              onInsert={handleInsert}
              onOpen={handleOpen}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
})

