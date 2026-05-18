import { memo, useEffect, useState, useCallback } from 'react'
import { EditorView } from '@codemirror/view'
import { useStorage } from '../../core/storage'
import { useConfirmStore } from '../../stores/confirmStore'
import { logger } from '../../core/logger'
import { insertAttachmentLink } from './markdownCommands'
import type { AttachmentItem } from '../../core/storage'
import { logAction } from '../../core/log-backend'
import styles from './MarkdownWorkspace.module.css'

interface AttachmentsTabProps {
  attachmentCardPath: string
  view: EditorView | null
}

export const AttachmentsTab = memo(function AttachmentsTab({ attachmentCardPath, view }: AttachmentsTabProps) {
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

  const handleInsert = useCallback((item: AttachmentItem) => {
    if (!view) {
      logger.info('AttachmentsTab', 'Editor not ready or in preview mode, cannot insert.')
      return
    }
    
    // 如果焦点不在编辑器中，尝试强制聚焦
    if (!view.hasFocus) {
      view.focus()
    }
    
    // Slight delay to ensure focus is applied before inserting
    setTimeout(() => {
      insertAttachmentLink(view, item.path, item.isImage, item.name)
    }, 10)
  }, [view])

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
          await storage.importAttachment(attachmentCardPath, filePath)
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
    window.addEventListener('markdown-attachment-uploaded', handleRefresh)
    return () => {
      window.removeEventListener('markdown-attachment-uploaded', handleRefresh)
    }
  }, [loadAttachments])

  if (loading && attachments.length === 0) {
    return <div className={styles.sidebarEmpty}>加载中...</div>
  }

  return (
    <div className={styles.attachmentsContainer}>
      <div className={styles.attachmentsHeader}>
        <button className={styles.uploadButton} onClick={handleUpload} disabled={loading}>
          <span className={styles.uploadIcon}>+</span> 上传附件
        </button>
      </div>
      
      {attachments.length === 0 ? (
        <div className={styles.sidebarEmpty}>暂无附件<br/><span style={{ fontSize: '11px', marginTop: 4, display: 'inline-block' }}>点击上方按钮或拖拽文件到编辑器</span></div>
      ) : (
        <div className={styles.attachmentList}>
          {attachments.map(item => (
            <div 
              key={item.name} 
              className={styles.attachmentItem}
              onDoubleClick={() => handleInsert(item)}
              title={view ? "双击插入到编辑器" : "切换到编辑模式后双击插入"}
              style={{ opacity: view ? 1 : 0.6 }}
            >
              <div className={styles.attachmentIcon}>
                {item.isImage ? '🖼️' : '📄'}
              </div>
              <div className={styles.attachmentInfo}>
                <div className={styles.attachmentName}>{item.name}</div>
                <div className={styles.attachmentMeta}>
                  {(item.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button 
                className={styles.attachmentDeleteBtn} 
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
