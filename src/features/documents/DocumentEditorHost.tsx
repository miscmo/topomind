import React from 'react'
import { DocumentWorkspaceLayout } from './components/Layout/DocumentWorkspaceLayout'
import type { TocItem } from './types/workspaceTypes'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import { topoDocumentIdFromPath } from './types/documentTypes'
import { getTopoDocumentTypeDefinition, TOPO_DOCUMENT_TYPES } from './services/documentTypeRegistry'
import { getDocumentEditorAdapter } from './services/documentEditorRegistry'
import { DocumentStatusBar } from './components/Layout/DocumentStatusBar'

interface DocumentEditorHostProps {
  value: unknown
  isDirty: boolean
  isContentLoaded?: boolean
  onChange: (value: unknown) => void
  onSave: () => Promise<void> | void
  attachmentCardPath: string | null
  detailHeader: React.ReactNode
  documentsTabContent?: React.ReactNode
  activeDetailDocumentPath: string
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onOpenDetailDocumentLink: (documentPath: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  isDetailDocumentBusy?: boolean
  topoDocuments: TopoDocumentManifestItem[]
}

export function DocumentEditorHost({
  value,
  isDirty,
  isContentLoaded = true,
  onChange,
  onSave,
  attachmentCardPath,
  detailHeader,
  documentsTabContent,
  activeDetailDocumentPath,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onCreateTopoDocument,
  isDetailDocumentBusy,
  topoDocuments,
}: DocumentEditorHostProps) {
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDetailDocumentPath)
  const activeTopoDocument = activeTopoDocumentId
    ? topoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
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
        attachmentCardPath={attachmentCardPath}
        documentType="detail"
        detailSidebarCollapsed={detailSidebarCollapsed}
        detailSidebarFloating={detailSidebarFloating}
        onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
        onSidebarHoverChange={onSidebarHoverChange}
        detailHeader={detailHeader}
        documentsTabContent={documentsTabContent}
        activeDetailDocumentPath={activeDetailDocumentPath}
        editorContent={(
          <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
            <div className="max-w-[360px] rounded-2xl text-center flex flex-col items-center gap-3">
              <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">当前节点还没有文档</div>
              <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">创建一个智能文档开始记录，也可以新建思维导图或流程图。</div>
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
    value,
    title: activeTopoDocument.title,
    onChange,
    attachmentCardPath,
    attachmentInsertTargetKey: activeDetailDocumentPath,
    onTocChange: setSmartTocItems,
    onTocItemClickReady: handleSmartTocItemClickReady,
    onWordCountChange: setDocumentStats,
  })

  return (
    <DocumentWorkspaceLayout
      isDirty={isDirty}
      onChange={onChange}
      onSave={onSave}
      attachmentCardPath={attachmentCardPath}
      documentType="detail"
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      detailHeader={detailHeader}
      documentsTabContent={documentsTabContent}
      activeDetailDocumentPath={activeDetailDocumentPath}
      tocItems={adapter.hasToc ? smartTocItems : undefined}
      onTocItemClick={adapter.hasToc ? smartTocItemClick ?? undefined : undefined}
      editorContent={editorContent}
      renderStatusBar={({ saveStatus, lastSavedAt, saveError }) => (
        <DocumentStatusBar
          stats={adapter.hasStats ? documentStats : null}
          saveStatus={saveStatus}
          saveError={saveError}
          lastSavedAt={lastSavedAt}
        />
      )}
    />
  )
}
