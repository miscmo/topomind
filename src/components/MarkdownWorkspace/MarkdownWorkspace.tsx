import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { EditorView } from '@codemirror/view'
import type { DetailSidebarTab, MarkdownWorkspaceProps, MarkdownViewMode } from './markdownTypes'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MarkdownStatusBar } from './MarkdownStatusBar'
import styles from './MarkdownWorkspace.module.css'

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
  detailDocuments,
  activeDetailDocumentPath,
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
  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(false)
  const [detailSidebarTab, setDetailSidebarTab] = useState<DetailSidebarTab>('documents')
  const [documentContextMenu, setDocumentContextMenu] = useState<DocumentContextMenuState | null>(null)
  const [documentInlineEdit, setDocumentInlineEdit] = useState<DocumentInlineEditState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const documentInlineInputRef = useRef<HTMLInputElement>(null)
  const cancelInlineEditOnBlurRef = useRef(false)
  const tocItems = useMemo(() => documentType === 'detail' ? extractTocItems(value) : [], [documentType, value])
  const currentDetailDocumentPath = activeDetailDocumentPath ?? '_content.md'
  const currentViewMode = controlledViewMode ?? internalViewMode

  const setViewMode = useCallback((mode: MarkdownViewMode) => {
    if (controlledViewMode === undefined) {
      setInternalViewMode(mode)
    }
    onViewModeChange?.(mode)
  }, [controlledViewMode, onViewModeChange])

  useEffect(() => {
    if (!documentContextMenu) return
    const handleClose = () => setDocumentContextMenu(null)
    window.addEventListener('pointerdown', handleClose)
    window.addEventListener('blur', handleClose)
    return () => {
      window.removeEventListener('pointerdown', handleClose)
      window.removeEventListener('blur', handleClose)
    }
  }, [documentContextMenu])

  useEffect(() => {
    setDocumentContextMenu(null)
  }, [detailSidebarCollapsed, detailSidebarTab, currentDetailDocumentPath])

  useEffect(() => {
    if (!documentInlineEdit) return
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
    } catch (err: any) {
      setSaveError(err.message || '保存失败')
    } finally {
      setIsSaving(false)
    }
  }, [value, savedValue, isSaving, onSave])

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
      className={`${styles.workspace} ${documentType}`} 
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
      
      <div className={styles.content}>
        {documentType === 'detail' && (
          <aside className={`${styles.sidebarPane} ${detailSidebarCollapsed ? styles.sidebarPaneCollapsed : ''}`}>
            <div className={styles.sidebarHeader}>
              {!detailSidebarCollapsed ? (
                <>
                  <div className={styles.sidebarTabs}>
                    <button
                      type="button"
                      className={`${styles.sidebarTab} ${detailSidebarTab === 'documents' ? styles.sidebarTabActive : ''}`}
                      onClick={() => setDetailSidebarTab('documents')}
                    >
                      文档列表
                    </button>
                    <button
                      type="button"
                      className={`${styles.sidebarTab} ${detailSidebarTab === 'toc' ? styles.sidebarTabActive : ''}`}
                      onClick={() => setDetailSidebarTab('toc')}
                    >
                      目录
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.sidebarCollapseBtn}
                    onClick={() => setDetailSidebarCollapsed(true)}
                    title="收起侧栏"
                  >
                    <span className={styles.sidebarChevron}>▾</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.sidebarCollapseBtn}
                  onClick={() => setDetailSidebarCollapsed(false)}
                  title="展开侧栏"
                >
                  <span className={`${styles.sidebarChevron} ${styles.sidebarChevronCollapsed}`}>▾</span>
                </button>
              )}
            </div>
            {!detailSidebarCollapsed && (
              <>
                {detailSidebarTab === 'documents' ? (
                  <div
                    className={styles.sidebarBody}
                    onContextMenu={(event) => openDocumentContextMenu(event, null, false)}
                  >
                    {detailDocuments && detailDocuments.length > 0 ? (
                      <div className={styles.documentList}>
                        {documentInlineEdit?.mode === 'create' && (
                          <div className={`${styles.documentItem} ${styles.documentItemEditing}`}>
                            <input
                              ref={documentInlineInputRef}
                              className={styles.documentInlineInput}
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
                                className={`${styles.documentItem} ${styles.documentItemEditing}`}
                              >
                                <input
                                  ref={documentInlineInputRef}
                                  className={styles.documentInlineInput}
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
                                className={`${styles.documentItem} ${isActive ? styles.documentItemActive : ''}`}
                                onClick={() => onSelectDetailDocument?.(item.path)}
                                onContextMenu={(event) => {
                                  event.stopPropagation()
                                  openDocumentContextMenu(event, item.path, item.isDefault)
                                }}
                                title={item.name}
                              >
                                <span className={styles.documentName}>{item.name}</span>
                              </button>
                            )
                          )
                        })}
                      </div>
                    ) : (
                      documentInlineEdit?.mode === 'create' ? (
                        <div className={styles.documentList}>
                          <div className={`${styles.documentItem} ${styles.documentItemEditing}`}>
                            <input
                              ref={documentInlineInputRef}
                              className={styles.documentInlineInput}
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
                        <div className={styles.sidebarEmpty}>暂无文档</div>
                      )
                    )}
                  </div>
                ) : (
                  tocItems.length > 0 ? (
                    <div className={styles.tocList}>
                      {tocItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className={styles.tocItem}
                          style={{ paddingLeft: `${12 + (item.level - 1) * 14}px` }}
                          onClick={() => handleTocJump(item)}
                          title={item.text}
                        >
                          {item.text}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.sidebarEmpty}>当前文档暂无目录</div>
                  )
                )}
              </>
            )}

            {documentContextMenu && detailSidebarTab === 'documents' && !detailSidebarCollapsed && (
              <div
                className={styles.documentContextMenu}
                style={{ left: documentContextMenu.x, top: documentContextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {!documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className={styles.documentContextMenuItem}
                    onClick={() => handleContextMenuAction('create')}
                    disabled={isDetailDocumentBusy}
                  >
                    新建文档
                  </button>
                )}
                {documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className={styles.documentContextMenuItem}
                    onClick={() => handleContextMenuAction('rename')}
                    disabled={documentContextMenu.isDefault || isDetailDocumentBusy}
                  >
                    重命名
                  </button>
                )}
                {documentContextMenu.targetPath && (
                  <button
                    type="button"
                    className={styles.documentContextMenuItem}
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

        <div className={styles.mainPane}>
          {currentViewMode === 'edit' && (
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
          
          {currentViewMode === 'preview' && documentType !== 'card' && (
            <div className={`${styles.pane} ${styles.previewPane}`}>
              <MarkdownPreview
                content={value}
                attachmentCardPath={attachmentCardPath}
                compact={documentType === 'card'}
                className={previewClassName}
                surfaceRef={previewRef}
                headingIds={tocItems.map(item => item.id)}
                onOpenDetailDocumentLink={documentType === 'detail' ? onOpenDetailDocumentLink : undefined}
              />
            </div>
          )}
        </div>
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
