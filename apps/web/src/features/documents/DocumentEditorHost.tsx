import React from 'react'
import { DocumentWorkspaceLayout } from './components/Layout/DocumentWorkspaceLayout'
import type { DetailSidebarTab, DocumentSyncStatus, TocItem } from './types/workspaceTypes'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import { topoDocumentIdFromKey } from './types/documentTypes'
import { getTopoDocumentTypeDefinition, TOPO_DOCUMENT_TYPES } from './services/documentTypeRegistry'
import { getDocumentEditorAdapter } from './services/documentEditorRegistry'
import { DocumentStatusBar } from './components/Layout/DocumentStatusBar'

interface DocumentEditorHostProps {
  readOnly?: boolean
  value: unknown
  isDirty: boolean
  syncStatus?: DocumentSyncStatus | null
  isContentLoaded?: boolean
  onChange: (value: unknown) => void
  onSave: () => Promise<void> | void
  attachmentCardRef: string | null
  detailHeader: React.ReactNode
  documentsTabContent?: React.ReactNode
  activeDetailDocumentKey: string
  detailSidebarTab?: DetailSidebarTab
  onDetailSidebarTabChange?: (tab: DetailSidebarTab) => void
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onOpenDetailDocumentLink: (documentKey: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  isDetailDocumentBusy?: boolean
  topoDocuments: TopoDocumentManifestItem[]
}

export function DocumentEditorHost({
  readOnly = false,
  value,
  isDirty,
  syncStatus,
  isContentLoaded = true,
  onChange,
  onSave,
  attachmentCardRef,
  detailHeader,
  documentsTabContent,
  activeDetailDocumentKey,
  detailSidebarTab,
  onDetailSidebarTabChange,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onCreateTopoDocument,
  isDetailDocumentBusy,
  topoDocuments,
}: DocumentEditorHostProps) {
  const activeTopoDocumentId = topoDocumentIdFromKey(activeDetailDocumentKey)
  const activeTopoDocument = activeTopoDocumentId
    ? topoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
  const effectiveReadOnly = readOnly
  const shouldRenderNoDocument = !activeTopoDocument
  const [smartTocItems, setSmartTocItems] = React.useState<TocItem[]>([])
  const [smartTocItemClick, setSmartTocItemClick] = React.useState<((item: TocItem) => void) | null>(null)
  const [documentStats, setDocumentStats] = React.useState<{ characters: number; words: number; blocks: number } | null>(null)

  const handleSmartTocItemClickReady = React.useCallback((handler: ((item: TocItem) => void) | null) => {
    setSmartTocItemClick(() => handler)
  }, [])

  if (shouldRenderNoDocument) {
    return (
      <DocumentWorkspaceLayout
        isDirty={false}
        onChange={() => {}}
        onSave={() => {}}
        attachmentCardRef={attachmentCardRef}
        documentType="detail"
        detailSidebarCollapsed={detailSidebarCollapsed}
        detailSidebarFloating={detailSidebarFloating}
        onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
        onSidebarHoverChange={onSidebarHoverChange}
        detailHeader={detailHeader}
        documentsTabContent={documentsTabContent}
        activeDetailDocumentKey={activeDetailDocumentKey}
        detailSidebarTab={detailSidebarTab}
        onDetailSidebarTabChange={onDetailSidebarTabChange}
        editorContent={(
          <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
            <div className="max-w-[360px] rounded-2xl text-center flex flex-col items-center gap-3">
              <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">当前节点还没有文档</div>
              <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                {readOnly
                  ? '当前工作区详情已切到只读模式，无法在这里创建或编辑文档。'
                  : '创建一个智能文档开始记录，也可以新建思维导图或流程图。'}
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {TOPO_DOCUMENT_TYPES.map((type, index) => {
                    const definition = getTopoDocumentTypeDefinition(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        className={index === 0
                          ? 'h-8 px-3 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50'
                          : 'h-8 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] font-semibold cursor-pointer disabled:opacity-50 hover:bg-[var(--color-hover-bg)]'}
                        onClick={() => onCreateTopoDocument(type, definition.defaultTitle)}
                        disabled={isDetailDocumentBusy}
                      >
                        {index === 0 ? `新建${definition.label}` : definition.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      />
    )
  }

  const adapter = getDocumentEditorAdapter(activeTopoDocument.type)
  const loadingContent = (
    <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
      <div className="text-[13px] text-[var(--color-text-muted)]">正在加载文档内容...</div>
    </div>
  )
  const editorContent = !isContentLoaded ? loadingContent : adapter.render({
    readOnly: effectiveReadOnly,
    value,
    title: activeTopoDocument.title,
    onChange,
    attachmentCardRef,
    attachmentInsertTargetKey: activeDetailDocumentKey,
    onTocChange: setSmartTocItems,
    onTocItemClickReady: handleSmartTocItemClickReady,
    onWordCountChange: setDocumentStats,
  })

  return (
    <DocumentWorkspaceLayout
      isDirty={isDirty}
      onChange={onChange}
      onSave={onSave}
      attachmentCardRef={attachmentCardRef}
      documentType="detail"
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      detailHeader={detailHeader}
      documentsTabContent={documentsTabContent}
      activeDetailDocumentKey={activeDetailDocumentKey}
      detailSidebarTab={detailSidebarTab}
      onDetailSidebarTabChange={onDetailSidebarTabChange}
      tocItems={adapter.hasToc ? smartTocItems : undefined}
      onTocItemClick={adapter.hasToc ? smartTocItemClick ?? undefined : undefined}
      editorContent={editorContent}
      renderStatusBar={({ saveStatus, lastSavedAt, saveError }) => (
        <DocumentStatusBar
          stats={adapter.hasStats ? documentStats : null}
          saveStatus={saveStatus}
          saveError={saveError}
          lastSavedAt={lastSavedAt}
          syncStatus={syncStatus}
        />
      )}
    />
  )
}
