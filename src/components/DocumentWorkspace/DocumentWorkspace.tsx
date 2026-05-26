import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem } from '../../core/storage'
import { DocumentSidebar } from './DocumentSidebar'
import { DocumentEditorHost } from './DocumentEditorHost'

interface DocumentWorkspaceProps {
  value: string
  savedValue: string
  isContentLoaded?: boolean
  onChange: (value: string) => void
  onSave: () => Promise<void> | void
  attachmentCardPath: string | null
  detailHeader: ReactNode
  topoDocuments: TopoDocumentManifestItem[]
  activeDocumentPath: string
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
  detailHeader,
  topoDocuments,
  activeDocumentPath,
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
      detailHeader={detailHeader}
      documentsTabContent={sidebarContent}
      activeDetailDocumentPath={activeDocumentPath}
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
