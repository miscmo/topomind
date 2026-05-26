import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { DetailSidebarTab, DocumentWorkspaceLayoutProps, TocItem } from './workspaceTypes'
import { AttachmentsTab } from './AttachmentsTab'
import { useResizePanel } from '../../hooks/useResizePanel'
import { logAction } from '../../core/log-backend'

export const DocumentWorkspaceLayout = memo(function DocumentWorkspaceLayout({
  value,
  savedValue,
  onChange,
  onSave,
  attachmentCardPath,
  documentType,
  detailHeader,
  documentsTabContent,
  activeDetailDocumentPath,
  detailSidebarCollapsed: controlledDetailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  tocItems: providedTocItems,
  onTocItemClick,
  editorContent
}: DocumentWorkspaceLayoutProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [internalDetailSidebarCollapsed, setInternalDetailSidebarCollapsed] = useState(false)
  const [detailSidebarWidth, setDetailSidebarWidth] = useState(180)
  const [detailSidebarTab, setDetailSidebarTab] = useState<DetailSidebarTab>('documents')
  const containerRef = useRef<HTMLDivElement>(null)
  
  const tocItems = providedTocItems ?? []
  const currentDetailDocumentPath = activeDetailDocumentPath ?? ''
  const detailSidebarCollapsed = controlledDetailSidebarCollapsed ?? internalDetailSidebarCollapsed
  const effectiveFloating = detailSidebarFloating
  const showSidebarContent = !detailSidebarCollapsed || effectiveFloating

  const { isResizing: isSidebarResizing, handleMouseDown: handleSidebarResizeMouseDown } = useResizePanel({
    initialWidth: detailSidebarWidth,
    onWidthChange: setDetailSidebarWidth,
    minWidth: 180,
    maxWidth: 360,
    direction: 'left',
  })

  const setDetailSidebarCollapsed = useCallback((collapsed: boolean) => {
    if (controlledDetailSidebarCollapsed === undefined) {
      setInternalDetailSidebarCollapsed(collapsed)
    }
    onDetailSidebarCollapsedChange?.(collapsed)
  }, [controlledDetailSidebarCollapsed, onDetailSidebarCollapsedChange])

  // Auto-save logic
  const saveTimeoutRef = useRef<number | undefined>(undefined)
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
    try {
      await onSave()
      logAction('Document:保存成功', 'DocumentWorkspaceLayout', { documentType, path: currentDetailDocumentPath })
    } catch (err: any) {
      logAction('Document:保存失败', 'DocumentWorkspaceLayout', { error: err.message, documentType })
    } finally {
      setIsSaving(false)
    }
  }, [value, savedValue, isSaving, onSave, documentType, currentDetailDocumentPath])

  const handleTocJump = useCallback((item: TocItem) => {
    if (onTocItemClick) {
      onTocItemClick(item)
    }
  }, [onTocItemClick])

  return (
    <div 
      ref={containerRef}
      className={`flex flex-col h-full border border-[var(--color-border)] rounded-[10px] overflow-hidden bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] shadow-[var(--shadow-sm)] ${documentType}`} 
    >
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
                  documentsTabContent
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
                      />
                    )}
                  </div>
                ) : null}
              </>
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
            {editorContent && (
              <div className="flex-1 min-w-0 min-h-0">
                {editorContent}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
