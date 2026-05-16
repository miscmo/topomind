import { memo, useState, useCallback, useRef, useEffect } from 'react'
import type { EditorView } from '@codemirror/view'
import type { MarkdownWorkspaceProps, MarkdownViewMode } from './markdownTypes'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MarkdownStatusBar } from './MarkdownStatusBar'

export const MarkdownWorkspace = memo(function MarkdownWorkspace({
  value,
  savedValue,
  onChange,
  onSave,
  attachmentCardPath,
  documentType,
  placeholder
}: MarkdownWorkspaceProps) {
  // Default to edit mode for cards, split for detail if space permits
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(documentType === 'card' ? 'edit' : 'split')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Responsive mode fallback
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width < 500 && viewMode === 'split') {
          setViewMode('edit')
        }
      }
    })
    
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    
    return () => observer.disconnect()
  }, [viewMode])

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
      className={`markdown-workspace ${documentType}`} 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        border: '1px solid #eaeaea', 
        borderRadius: '4px',
        overflow: 'hidden',
        backgroundColor: '#fff'
      }}
    >
      <MarkdownToolbar 
        view={editorView}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSave={handleSave}
        isSaving={isSaving}
      />
      
      <div className="markdown-workspace-content" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div style={{ flex: 1, minWidth: 0, borderRight: viewMode === 'split' ? '1px solid #eaeaea' : 'none' }}>
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
        
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div style={{ flex: 1, minWidth: 0, backgroundColor: '#fcfcfc' }}>
            <MarkdownPreview
              content={value}
              attachmentCardPath={attachmentCardPath}
              compact={documentType === 'card'}
            />
          </div>
        )}
      </div>

      <MarkdownStatusBar
        value={value}
        savedValue={savedValue}
        isSaving={isSaving}
        saveError={saveError}
      />
    </div>
  )
})
