import { memo, useState, useCallback, useRef, useEffect } from 'react'
import type { EditorView } from '@codemirror/view'
import type { MarkdownWorkspaceProps, MarkdownViewMode } from './markdownTypes'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MarkdownStatusBar } from './MarkdownStatusBar'
import styles from './MarkdownWorkspace.module.css'

export const MarkdownWorkspace = memo(function MarkdownWorkspace({
  value,
  savedValue,
  onChange,
  onSave,
  attachmentCardPath,
  documentType,
  placeholder,
  previewClassName
}: MarkdownWorkspaceProps) {
  // Default to preview mode for details, edit mode for cards
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(documentType === 'detail' ? 'preview' : 'edit')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-save logic
  const saveTimeoutRef = useRef<number>()
  useEffect(() => {
    if (value !== savedValue) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = window.setTimeout(() => {
        handleSave()
      }, 1500)
    }
    return () => clearTimeout(saveTimeoutRef.current)
  }, [value, savedValue])

  const handleSave = useCallback(async () => {
    if (value === savedValue || isSaving) return
    
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave()
    } catch (err: any) {
      setSaveError(err.message || '保存失败')
    } finally {
      setIsSaving(false)
    }
  }, [value, savedValue, isSaving, onSave])

  const handleEditorCreate = useCallback((view: EditorView) => {
    setEditorView(view)
  }, [])

  return (
    <div 
      ref={containerRef}
      className={`${styles.workspace} ${documentType}`} 
    >
      {documentType !== 'card' && (
        <MarkdownToolbar 
          view={editorView}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}
      
      <div className={styles.content}>
        {viewMode === 'edit' && (
          <div className={styles.pane}>
            <MarkdownSourceEditor
              value={value}
              onChange={onChange}
              onSave={handleSave}
              onEditorCreate={handleEditorCreate}
              attachmentCardPath={attachmentCardPath}
              placeholder={placeholder}
            />
          </div>
        )}
        
        {viewMode === 'preview' && documentType !== 'card' && (
          <div className={`${styles.pane} ${styles.previewPane}`}>
            <MarkdownPreview
              content={value}
              attachmentCardPath={attachmentCardPath}
              compact={documentType === 'card'}
              className={previewClassName}
            />
          </div>
        )}
      </div>

      {documentType !== 'card' && (
        <MarkdownStatusBar
          value={value}
          savedValue={savedValue}
          isSaving={isSaving}
          saveError={saveError}
        />
      )}
    </div>
  )
})
