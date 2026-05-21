import { memo, useCallback } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  toggleBold,
  toggleItalic,
  insertHeading,
  insertLink,
  insertImage,
  insertAttachmentLink,
  insertCodeBlock,
  insertMermaidBlock,
  insertTable,
  insertTaskList
} from './markdownCommands'
import type { MarkdownViewMode } from './markdownTypes'
import { useStorage } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'

interface MarkdownToolbarProps {
  view: EditorView | null
  viewMode: MarkdownViewMode
  onViewModeChange: (mode: MarkdownViewMode) => void
  onSave?: () => void
  isSaving?: boolean
  attachmentCardPath?: string | null
}

export const MarkdownToolbar = memo(function MarkdownToolbar({ 
  view, 
  viewMode, 
  onViewModeChange,
  onSave,
  isSaving,
  attachmentCardPath
}: MarkdownToolbarProps) {
  const storage = useStorage()
  
  const handleCommand = (cmd: (v: EditorView) => void) => {
    if (view) {
      if (viewMode === 'preview') {
        onViewModeChange('edit')
      }
      cmd(view)
    }
  }

  const handleUploadAttachment = useCallback(async () => {
    if (!attachmentCardPath || !view) return
    try {
      const filePaths = await window.electronAPI?.invoke('app:openFileDialog', {
        properties: ['openFile', 'multiSelections'],
        title: '选择要导入的附件'
      }) as string[] | undefined
      
      if (filePaths && filePaths.length > 0) {
        let count = 0
        for (const filePath of filePaths) {
          const relPath = await storage.importAttachment(attachmentCardPath, filePath)
          const fileName = relPath.split('/').pop() || 'attachment'
          const ext = fileName.split('.').pop()?.toLowerCase() || ''
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
          
          insertAttachmentLink(view, relPath, isImage, fileName)
          count++
        }
        logAction('MarkdownToolbar:插入本地附件', 'MarkdownToolbar', { attachmentCardPath, count })
        
        // Notify AttachmentsTab to refresh
        window.dispatchEvent(new Event('markdown-attachment-uploaded'))
        view.focus()
      }
    } catch (e) {
      logger.catch('MarkdownToolbar', 'handleUploadAttachment', e)
    }
  }, [attachmentCardPath, view, storage])

  return (
    <div className="flex items-center p-2 px-3 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] backdrop-blur-[10px] gap-2 flex-wrap">
      <div className="flex gap-[2px] mr-auto items-center">
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="粗体" onClick={() => handleCommand(toggleBold)}><b>B</b></button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="斜体" onClick={() => handleCommand(toggleItalic)}><i>I</i></button>
        <div className="w-px h-4 bg-[var(--color-border-strong)] mx-[6px]" />
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="标题" onClick={() => handleCommand(v => insertHeading(v, 2))}>H</button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="任务" onClick={() => handleCommand(insertTaskList)}>☑</button>
        <div className="w-px h-4 bg-[var(--color-border-strong)] mx-[6px]" />
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="附件" onClick={handleUploadAttachment} disabled={!attachmentCardPath}>📎</button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="链接" onClick={() => handleCommand(insertLink)}>🔗</button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="图片" onClick={() => handleCommand(insertImage)}>🖼</button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="表格" onClick={() => handleCommand(insertTable)}>⊞</button>
        <div className="w-px h-4 bg-[var(--color-border-strong)] mx-[6px]" />
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="代码块" onClick={() => handleCommand(v => insertCodeBlock(v))}>{'<>'}</button>
        <button type="button" className="flex items-center justify-center w-7 h-7 border-none bg-transparent rounded-lg text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 text-[14px] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-muted)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" title="Mermaid 图表" onClick={() => handleCommand(insertMermaidBlock)}>M</button>
      </div>

      <div className="flex gap-3 items-center">
        <div className="flex bg-[var(--color-bg-muted)] p-[2px] border border-[var(--color-border)] rounded-[9px]">
          <button 
            type="button"
            className={`border-none bg-transparent py-[5px] px-[14px] rounded-[7px] text-[12px] font-semibold text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 ${viewMode === 'edit' ? 'bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]' : ''}`}
            onClick={() => onViewModeChange('edit')}
          >
            编辑
          </button>
          <button 
            type="button"
            className={`border-none bg-transparent py-[5px] px-[14px] rounded-[7px] text-[12px] font-semibold text-[var(--color-text-secondary)] cursor-pointer transition-all duration-150 ${viewMode === 'preview' ? 'bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]' : ''}`}
            onClick={() => onViewModeChange('preview')}
          >
            预览
          </button>
        </div>
      </div>
    </div>
  )
})
