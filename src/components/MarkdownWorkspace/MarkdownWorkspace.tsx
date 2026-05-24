import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { EditorView } from '@codemirror/view'
import type { DetailSidebarTab, MarkdownWorkspaceProps, MarkdownViewMode } from './markdownTypes'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MarkdownStatusBar } from './MarkdownStatusBar'
import { AttachmentsTab } from './AttachmentsTab'
import { useResizePanel } from '../../hooks/useResizePanel'
import { logAction } from '../../core/log-backend'

interface TocItem {
  id: string
  level: number
  text: string
  line: number
}

interface DocumentContextMenuState {
  x: number
  y: number
  targetPath: string | null
  isDefault: boolean
}

interface DocumentInlineEditState {
  mode: 'create' | 'rename'
  targetPath: string | null
  value: string
}

function normalizeHeadingText(raw: string) {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function extractTocItems(markdown: string): TocItem[] {
  if (typeof markdown !== 'string') return []
  const lines = markdown.split(/\r?\n/)
  const items: TocItem[] = []
  const slugCount = new Map<string, number>()
  let inCodeFence = false

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence
      return
    }
    if (inCodeFence) return

    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) return

    const text = normalizeHeadingText(match[2].replace(/\s+#+\s*$/, ''))
    if (!text) return

    const baseSlug = slugifyHeading(text) || 'section'
    const seen = slugCount.get(baseSlug) ?? 0
    slugCount.set(baseSlug, seen + 1)
    const suffix = seen > 0 ? `-${seen + 1}` : ''

    items.push({
      id: `md-heading-${baseSlug}${suffix}`,
      level: match[1].length,
      text,
      line: index + 1,
    })
  })

  return items
}

export const MarkdownWorkspace = memo(function MarkdownWorkspace({
  value,
  savedValue,
  onChange,
  onSave,
  attachmentCardPath,
  documentType,
  placeholder,
  previewClassName,
  detailHeader,
  detailDocuments,
  activeDetailDocumentPath,
  detailSidebarCollapsed: controlledDetailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  viewMode: controlledViewMode,
  onViewModeChange,
  showToolbar = documentType !== 'card',
  onSelectDetailDocument,
  onOpenDetailDocumentLink,
  onCreateDetailDocument,
  onRenameDetailDocument,
  onDeleteDetailDocument,
  isDetailDocumentBusy
}: MarkdownWorkspaceProps) {
  // Default to preview mode for details, edit mode for cards
  const [internalViewMode, setInternalViewMode] = useState<MarkdownViewMode>(documentType === 'detail' ? 'preview' : 'edit')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [internalDetailSidebarCollapsed, setInternalDetailSidebarCollapsed] = useState(false)
  const [detailSidebarWidth, setDetailSidebarWidth] = useState(180)
  const [detailSidebarTab, setDetailSidebarTab] = useState<DetailSidebarTab>('documents')
  const [documentContextMenu, setDocumentContextMenu] = useState<DocumentContextMenuState | null>(null)
  const [documentInlineEdit, setDocumentInlineEdit] = useState<DocumentInlineEditState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const documentInlineInputRef = useRef<HTMLInputElement>(null)
  const cancelInlineEditOnBlurRef = useRef(false)
  const lastDocumentInlineEditKeyRef = useRef<string | null>(null)
  const tocItems = useMemo(() => documentType === 'detail' ? extractTocItems(value) : [], [documentType, value])
  const currentDetailDocumentPath = activeDetailDocumentPath ?? '_content.md'
  const detailSidebarCollapsed = controlledDetailSidebarCollapsed ?? internalDetailSidebarCollapsed
  const isSidebarBusy = !!documentContextMenu || !!documentInlineEdit
  const effectiveFloating = detailSidebarFloating || (detailSidebarCollapsed && isSidebarBusy)
  const showSidebarContent = !detailSidebarCollapsed || effectiveFloating
  const currentViewMode = controlledViewMode ?? internalViewMode
  const statusBar = documentType !== 'card' ? (
    <MarkdownStatusBar
      value={value}
      savedValue={savedValue}
      isSaving={isSaving}
      saveError={saveError}
    />
  ) : null
  const { isResizing: isSidebarResizing, handleMouseDown: handleSidebarResizeMouseDown } = useResizePanel({
    initialWidth: detailSidebarWidth,
    onWidthChange: setDetailSidebarWidth,
    minWidth: 180,
    maxWidth: 360,
    direction: 'left',
  })

  const setViewMode = useCallback((mode: MarkdownViewMode) => {
    if (controlledViewMode === undefined) {
      setInternalViewMode(mode)
    }
    onViewModeChange?.(mode)
  }, [controlledViewMode, onViewModeChange])

  const setDetailSidebarCollapsed = useCallback((collapsed: boolean) => {
    if (controlledDetailSidebarCollapsed === undefined) {
      setInternalDetailSidebarCollapsed(collapsed)
    }
    onDetailSidebarCollapsedChange?.(collapsed)
  }, [controlledDetailSidebarCollapsed, onDetailSidebarCollapsedChange])

  useEffect(() => {
    if (!documentContextMenu) return
    const handleClose = () => setDocumentContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('pointerdown', handleClose)
    window.addEventListener('blur', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handleClose)
      window.removeEventListener('blur', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [documentContextMenu])

  useEffect(() => {
    setDocumentContextMenu(null)
  }, [detailSidebarCollapsed, detailSidebarTab, currentDetailDocumentPath])

  useEffect(() => {
    if (!documentInlineEdit) {
      lastDocumentInlineEditKeyRef.current = null
      return
    }
    const editKey = `${documentInlineEdit.mode}:${documentInlineEdit.targetPath ?? '__new__'}`
    if (lastDocumentInlineEditKeyRef.current === editKey) return
    lastDocumentInlineEditKeyRef.current = editKey
    documentInlineInputRef.current?.focus()
    documentInlineInputRef.current?.select()
  }, [documentInlineEdit])

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
      logAction('Markdown:保存成功', 'MarkdownWorkspace', { documentType, path: currentDetailDocumentPath })
    } catch (err: any) {
      setSaveError(err.message || '保存失败')
      logAction('Markdown:保存失败', 'MarkdownWorkspace', { error: err.message, documentType })
    } finally {
      setIsSaving(false)
    }
  }, [value, savedValue, isSaving, onSave, documentType, currentDetailDocumentPath])

  const handleEditorCreate = useCallback((view: EditorView) => {
    setEditorView(view)
  }, [])

  const handleTocJump = useCallback((item: TocItem) => {
    if (currentViewMode === 'edit') {
      if (!editorView) return
      const line = editorView.state.doc.line(Math.min(item.line, editorView.state.doc.lines))
      editorView.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start' })
      })
      editorView.focus()
      return
    }

    const targetId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(item.id)
      : item.id
    const heading = previewRef.current?.querySelector(`#${targetId}`) as HTMLElement | null
    if (heading) {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [currentViewMode, editorView])

  const openDocumentContextMenu = useCallback((
    event: React.MouseEvent,
    targetPath: string | null,
    isDefault: boolean,
  ) => {
    event.preventDefault()
    setDocumentContextMenu({
      x: event.clientX,
      y: event.clientY,
      targetPath,
      isDefault,
    })
  }, [])

  const handleContextMenuAction = useCallback((action: 'create' | 'rename' | 'delete') => {
    if (action === 'create') {
      setDocumentInlineEdit({
        mode: 'create',
        targetPath: null,
        value: '',
      })
    } else if (action === 'rename' && documentContextMenu?.targetPath) {
      const targetDocument = detailDocuments?.find((item) => item.path === documentContextMenu.targetPath)
      if (targetDocument) {
        setDocumentInlineEdit({
          mode: 'rename',
          targetPath: documentContextMenu.targetPath,
          value: targetDocument.name,
        })
      }
    } else if (action === 'delete' && documentContextMenu?.targetPath) {
      onDeleteDetailDocument?.(documentContextMenu.targetPath)
    }
    setDocumentContextMenu(null)
  }, [detailDocuments, documentContextMenu, onDeleteDetailDocument])

  const cancelDocumentInlineEdit = useCallback(() => {
    setDocumentInlineEdit(null)
  }, [])

  const submitDocumentInlineEdit = useCallback(() => {
    if (!documentInlineEdit || isDetailDocumentBusy) return
    const nextName = documentInlineEdit.value.trim()

    if (!nextName) {
      setDocumentInlineEdit(null)
      return
    }

    if (documentInlineEdit.mode === 'create') {
      onCreateDetailDocument?.(nextName)
      setDocumentInlineEdit(null)
      return
    }

    if (!documentInlineEdit.targetPath) {
      setDocumentInlineEdit(null)
      return
    }

    const targetDocument = detailDocuments?.find((item) => item.path === documentInlineEdit.targetPath)
    if (targetDocument && targetDocument.name === nextName) {
      setDocumentInlineEdit(null)
      return
    }

    onRenameDetailDocument?.(documentInlineEdit.targetPath, nextName)
    setDocumentInlineEdit(null)
  }, [detailDocuments, documentInlineEdit, isDetailDocumentBusy, onCreateDetailDocument, onRenameDetailDocument])

  const handleDocumentInlineInputBlur = useCallback(() => {
    if (cancelInlineEditOnBlurRef.current) {
      cancelInlineEditOnBlurRef.current = false
      return
    }
    submitDocumentInlineEdit()
  }, [submitDocumentInlineEdit])

  const handleDocumentInlineInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitDocumentInlineEdit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      cancelDocumentInlineEdit()
    }
  }, [cancelDocumentInlineEdit, submitDocumentInlineEdit])

  return (
    <div 
      ref={containerRef}
      className={`flex flex-col h-full border border-[var(--color-border)] rounded-[10px] overflow-hidden bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] shadow-[var(--shadow-sm)] ${documentType}`} 
    >
      {showToolbar && (
        <MarkdownToolbar 
          view={editorView}
          viewMode={currentViewMode}
          onViewModeChange={setViewMode}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}
      
      <div className="flex flex-1 overflow-hidden relative">
        {documentType === 'detail' && (
          <aside
            className={`w-[180px] shrink-0 flex flex-col border-r border-[var(--color-border-light)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] ${
              effectiveFloating 
                ? 'absolute left-[12px] top-[42px] bottom-[16px] z-30 shadow-[0_12px_40px_rgba(15,23,42,0.16)] border border-[var(--color-border-strong)] rounded-[12px] overflow-hidden'
                : detailSidebarCollapsed 
                  ? '!w-0 !border-r-0 !bg-transparent overflow-hidden' 
                  : ''
            }`}
            style={!showSidebarContent ? undefined : { width: detailSidebarWidth }}
            onMouseEnter={() => onSidebarHoverChange?.(true)}
            onMouseLeave={() => onSidebarHoverChange?.(false)}
          >
            <div className="flex items-center justify-start gap-2 min-h-[58px] p-2.5 px-3 pb-2 border-b border-[var(--color-border-subtle)] bg-gradient-to-b from-[color-mix(in_srgb,var(--color-surface)_98%,transparent)] to-[var(--color-bg)] box-border">
              {showSidebarContent ? (
                <div className="w-full min-w-0">
                  <div className="flex gap-[2px] min-w-0 p-[2px] border border-[#e2e8f0] rounded-[10px] bg-[color-mix(in_srgb,var(--color-bg-muted)_88%,transparent)] shadow-[inset_0_1px_1px_rgba(148,163,184,0.08)]">
                    <button
                      type="button"
                      className={`flex-1 h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#73808c] text-[12px] font-semibold cursor-pointer transition-all duration-75 whitespace-nowrap hover:text-[#1a3a5c] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${detailSidebarTab === 'documents' ? 'bg-gradient-to-b from-white to-[#f8fbff] !text-[var(--color-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : ''}`}
                      onClick={() => setDetailSidebarTab('documents')}
                    >
                      文档
                    </button>
                    <button
                      type="button"
                      className={`flex-1 h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#73808c] text-[12px] font-semibold cursor-pointer transition-all duration-75 whitespace-nowrap hover:text-[#1a3a5c] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${detailSidebarTab === 'toc' ? 'bg-gradient-to-b from-white to-[#f8fbff] !text-[var(--color-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : ''}`}
                      onClick={() => setDetailSidebarTab('toc')}
                    >
                      目录
                    </button>
                    <button
                      type="button"
                      className={`flex-1 h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#73808c] text-[12px] font-semibold cursor-pointer transition-all duration-75 whitespace-nowrap hover:text-[#1a3a5c] hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed ${detailSidebarTab === 'attachments' ? 'bg-gradient-to-b from-white to-[#f8fbff] !text-[var(--color-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : ''}`}
                      onClick={() => setDetailSidebarTab('attachments')}
                      disabled={!attachmentCardPath}
                      title={!attachmentCardPath ? '当前环境暂不支持附件' : '附件'}
                    >
                      附件
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full" aria-hidden="true" />
              )}
            </div>
            {showSidebarContent && (
              <>
                {detailSidebarTab === 'documents' ? (
                  <div
                    className="flex-1 min-h-0 flex flex-col"
                    onContextMenu={(event) => openDocumentContextMenu(event, null, false)}
                  >
                    {detailDocuments && detailDocuments.length > 0 ? (
                      <div className="flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full">
                        {documentInlineEdit?.mode === 'create' && (
                          <div className={`w-full flex items-center justify-between mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[#f5f8fb] py-1 px-2 bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] cursor-default border border-[#94a3b829] !border-[var(--color-border-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]`}>
                            <input
                              ref={documentInlineInputRef}
                              className="flex-1 w-full min-h-[calc(1.35em+10px)] py-1 px-2.5 border border-transparent !border-[var(--color-border-light)] rounded-lg bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] text-[#1e293b] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-all duration-75 focus:bg-white/44 focus:!bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[#94a3b847] focus:!border-[var(--color-border)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:!shadow-[0_0_0_2px_var(--color-accent-soft)] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:text-[#94a3b8] placeholder:font-medium placeholder:!text-[var(--color-text-muted)]"
                              value={documentInlineEdit.value}
                              placeholder="输入文档名称"
                              onChange={(event) => setDocumentInlineEdit((current) => (
                                current ? { ...current, value: event.target.value } : current
                              ))}
                              onBlur={handleDocumentInlineInputBlur}
                              onKeyDown={handleDocumentInlineInputKeyDown}
                              onPointerDown={(event) => event.stopPropagation()}
                              disabled={isDetailDocumentBusy}
                            />
                          </div>
                        )}
                        {detailDocuments.map((item) => {
                          const isActive = item.path === currentDetailDocumentPath
                          const isEditing = documentInlineEdit?.mode === 'rename' && documentInlineEdit.targetPath === item.path
                          return (
                            isEditing ? (
                              <div
                                key={item.path}
                                className={`w-full flex items-center justify-between mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[#f5f8fb] py-1 px-2 bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] cursor-default border border-[#94a3b829] !border-[var(--color-border-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]`}
                              >
                                <input
                                  ref={documentInlineInputRef}
                                  className="flex-1 w-full min-h-[calc(1.35em+10px)] py-1 px-2.5 border border-transparent !border-[var(--color-border-light)] rounded-lg bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] text-[#1e293b] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-all duration-75 focus:bg-white/44 focus:!bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[#94a3b847] focus:!border-[var(--color-border)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:!shadow-[0_0_0_2px_var(--color-accent-soft)] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:text-[#94a3b8] placeholder:font-medium placeholder:!text-[var(--color-text-muted)]"
                                  value={documentInlineEdit.value}
                                  placeholder="输入文档名称"
                                  onChange={(event) => setDocumentInlineEdit((current) => (
                                    current ? { ...current, value: event.target.value } : current
                                  ))}
                                  onBlur={handleDocumentInlineInputBlur}
                                  onKeyDown={handleDocumentInlineInputKeyDown}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  disabled={isDetailDocumentBusy}
                                />
                              </div>
                            ) : (
                              <button
                                key={item.path}
                                type="button"
                                className={`group w-full flex items-center justify-between mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[#f5f8fb] ${isActive ? '!bg-[#edf4fb] !bg-[var(--color-selected-bg)]' : ''} ${(item.isDefault || item.isCard) ? 'text-[#1e293b] !text-[var(--color-text-primary)]' : ''}`}
                                onClick={() => onSelectDetailDocument?.(item.path)}
                                onContextMenu={(event) => {
                                  event.stopPropagation()
                                  openDocumentContextMenu(event, item.path, Boolean(item.isDefault || item.isCard))
                                }}
                                title={item.name}
                              >
                                <span className="block text-[12px] font-semibold text-[#334155] !text-[var(--color-text-primary)] leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis">{item.name}</span>
                                {(item.isDefault || item.isCard) && (
                                  <span className="inline-flex items-center justify-center ml-1 text-[var(--color-text-muted)] opacity-60 group-hover:opacity-100" title="固定文档，不可重命名或删除">
                                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none">
                                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                  </span>
                                )}
                              </button>
                            )
                          )
                        })}
                      </div>
                    ) : (
                      documentInlineEdit?.mode === 'create' ? (
                        <div className="flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full">
                          <div className={`w-full flex items-center justify-between mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[#f5f8fb] py-1 px-2 bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] cursor-default border border-[#94a3b829] !border-[var(--color-border-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]`}>
                            <input
                              ref={documentInlineInputRef}
                              className="flex-1 w-full min-h-[calc(1.35em+10px)] py-1 px-2.5 border border-transparent !border-[var(--color-border-light)] rounded-lg bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] text-[#1e293b] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-all duration-75 focus:bg-white/44 focus:!bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[#94a3b847] focus:!border-[var(--color-border)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:!shadow-[0_0_0_2px_var(--color-accent-soft)] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:text-[#94a3b8] placeholder:font-medium placeholder:!text-[var(--color-text-muted)]"
                              value={documentInlineEdit.value}
                              placeholder="输入文档名称"
                              onChange={(event) => setDocumentInlineEdit((current) => (
                                current ? { ...current, value: event.target.value } : current
                              ))}
                              onBlur={handleDocumentInlineInputBlur}
                              onKeyDown={handleDocumentInlineInputKeyDown}
                              onPointerDown={(event) => event.stopPropagation()}
                              disabled={isDetailDocumentBusy}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无文档</div>
                      )
                    )}
                  </div>
                ) : detailSidebarTab === 'toc' ? (
                  tocItems.length > 0 ? (
                    <div className="flex-1 overflow-y-auto p-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full">
                      {tocItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className="w-full min-h-[30px] block mb-1 py-1.5 pr-2.5 border-none rounded-lg bg-transparent text-[#475569] !text-[var(--color-text-muted)] text-left text-[12px] leading-[1.45] cursor-pointer transition-colors duration-75 whitespace-nowrap overflow-hidden text-ellipsis hover:bg-[#edf4fb] hover:!bg-[var(--color-selected-bg)] hover:text-[#0f172a] hover:!text-[var(--color-primary)]"
                          style={{ paddingLeft: `${12 + (item.level - 1) * 14}px` }}
                          onClick={() => handleTocJump(item)}
                          title={item.text}
                        >
                          {item.text}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 px-4 text-center text-[#94a3b8] !text-[var(--color-text-muted)] text-[13px] leading-[1.6]">当前文档暂无目录</div>
                  )
                ) : detailSidebarTab === 'attachments' ? (
                  <div className="flex-1 min-h-0 flex flex-col" style={{ padding: 0 }}>
                    {attachmentCardPath && (
                      <AttachmentsTab 
                        attachmentCardPath={attachmentCardPath} 
                        view={currentViewMode === 'edit' ? editorView : null}
                      />
                    )}
                  </div>
                ) : null}
              </>
            )}

            {documentContextMenu && detailSidebarTab === 'documents' && showSidebarContent && (
              <div
                className="fixed min-w-[128px] p-1.5 border border-[#dbe4ee] !border-[var(--color-border)] rounded-[10px] bg-white !bg-[color-mix(in_srgb,var(--color-surface-elevated)_96%,transparent)] shadow-[0_8px_24px_rgba(15,23,42,0.12)] !shadow-[var(--shadow-popover)] z-[1200]"
                style={{ left: documentContextMenu.x, top: documentContextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {!documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className="w-full h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#334155] !text-[var(--color-text-primary)] text-[12px] text-left cursor-pointer transition-colors duration-75 hover:not(:disabled):bg-[#f5f8fb] hover:not(:disabled):!bg-[var(--color-hover-bg)] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                    onClick={() => handleContextMenuAction('create')}
                    disabled={isDetailDocumentBusy}
                  >
                    新建文档
                  </button>
                )}
                {documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className="w-full h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#334155] !text-[var(--color-text-primary)] text-[12px] text-left cursor-pointer transition-colors duration-75 hover:not(:disabled):bg-[#f5f8fb] hover:not(:disabled):!bg-[var(--color-hover-bg)] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                    onClick={() => handleContextMenuAction('rename')}
                    disabled={documentContextMenu.isDefault || isDetailDocumentBusy}
                  >
                    重命名
                  </button>
                )}
                {documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className="w-full h-[30px] px-2.5 border-none rounded-lg bg-transparent text-[#334155] !text-[var(--color-text-primary)] text-[12px] text-left cursor-pointer transition-colors duration-75 hover:not(:disabled):bg-[#f5f8fb] hover:not(:disabled):!bg-[var(--color-hover-bg)] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                    onClick={() => handleContextMenuAction('delete')}
                    disabled={documentContextMenu.isDefault || isDetailDocumentBusy}
                  >
                    删除
                  </button>
                )}
              </div>
            )}
          </aside>
        )}
        {documentType === 'detail' && showSidebarContent && !effectiveFloating && (
          <div
            className={`w-[6px] h-full cursor-col-resize shrink-0 bg-transparent relative select-none transition-colors duration-75 before:content-[""] before:absolute before:top-0 before:bottom-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:bg-[#e6ebf1] before:transition-all before:duration-75 hover:before:bg-[#7aa2cc] hover:before:shadow-[0_0_0_1px_rgba(122,162,204,0.12)] ${isSidebarResizing ? 'before:!bg-[#7aa2cc] before:!shadow-[0_0_0_1px_rgba(122,162,204,0.12)]' : ''}`}
            onMouseDown={handleSidebarResizeMouseDown}
            title="拖拽调整侧栏宽度"
          />
        )}

        <div className={`flex flex-1 min-w-0 min-h-0 ${documentType === 'detail' ? 'flex-col' : ''}`}>
          {documentType === 'detail' && detailHeader && (
            <div className="shrink-0 border-b border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)]">
              {detailHeader}
            </div>
          )}

          <div className="flex flex-1 min-w-0 min-h-0">
            {currentViewMode === 'edit' && (
              <div className="flex-1 min-w-0 min-h-0">
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
            
            {currentViewMode === 'preview' && documentType === 'detail' && (
              <div className={`flex-1 min-w-0 min-h-0 bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]`}>
                <MarkdownPreview
                  content={value}
                  attachmentCardPath={attachmentCardPath}
                  compact={false}
                  className={previewClassName}
                  onChange={onChange}
                  surfaceRef={previewRef}
                  headingIds={tocItems.map(item => item.id)}
                  onOpenDetailDocumentLink={onOpenDetailDocumentLink}
                />
              </div>
            )}
          </div>

          {documentType === 'detail' && statusBar}
        </div>
      </div>

      {documentType !== 'detail' && statusBar}
    </div>
  )
})
