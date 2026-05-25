import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem } from '../../core/storage'
import type { MarkdownViewMode } from '../MarkdownWorkspace/markdownTypes'
import { DocumentSidebar } from './DocumentSidebar'
import { DocumentEditorHost } from './DocumentEditorHost'

interface DocumentWorkspaceProps {
  value: string
  savedValue: string
  isContentLoaded?: boolean
  onChange: (value: string) => void
  onSave: () => Promise<void> | void
  attachmentCardPath: string | null
  previewClassName?: string
  detailHeader: ReactNode
  topoDocuments: TopoDocumentManifestItem[]
  activeDocumentPath: string
  viewMode: MarkdownViewMode
  onViewModeChange: (mode: MarkdownViewMode) => void
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onSelectDocument: (documentPath: string) => void
  onOpenDetailDocumentLink: (documentPath: string) => void
  onCreateTopoSmartDocument: (name: string, parentId?: string | null) => void
  onCreateTopoMindMapDocument: (name: string, parentId?: string | null) => void
  onCreateTopoFlowchartDocument: (name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
  isDocumentBusy?: boolean
}

export function DocumentWorkspace({
  value,
  savedValue,
  isContentLoaded,
  onChange,
  onSave,
  attachmentCardPath,
  previewClassName,
  detailHeader,
  topoDocuments,
  activeDocumentPath,
  viewMode,
  onViewModeChange,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onSelectDocument,
  onOpenDetailDocumentLink,
  onCreateTopoSmartDocument,
  onCreateTopoMindMapDocument,
  onCreateTopoFlowchartDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
  isDocumentBusy,
}: DocumentWorkspaceProps) {
  const sidebarContent = (
    <DocumentSidebar
      topoDocuments={topoDocuments}
      activeDocumentPath={activeDocumentPath}
      isBusy={isDocumentBusy}
      onSelectDocument={onSelectDocument}
      onCreateTopoSmartDocument={onCreateTopoSmartDocument}
      onCreateTopoMindMapDocument={onCreateTopoMindMapDocument}
      onCreateTopoFlowchartDocument={onCreateTopoFlowchartDocument}
      onExportTopoDocument={onExportTopoDocument}
      onRenameDocument={onRenameDocument}
      onDeleteDocument={onDeleteDocument}
      onMoveDocument={onMoveDocument}
    />
  )

  return (
    <DocumentEditorHost
      value={value}
      savedValue={savedValue}
      isContentLoaded={isContentLoaded}
      onChange={onChange}
      onSave={onSave}
      attachmentCardPath={attachmentCardPath}
      previewClassName={previewClassName}
      detailHeader={detailHeader}
      documentsTabContent={sidebarContent}
      activeDetailDocumentPath={activeDocumentPath}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      onOpenDetailDocumentLink={onOpenDetailDocumentLink}
      isDetailDocumentBusy={isDocumentBusy}
      topoDocuments={topoDocuments}
    />
  )
}
