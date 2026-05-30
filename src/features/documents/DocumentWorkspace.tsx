import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import type { FSBTrashTopoDocumentItem } from '../../core/fs-backend'
import { DocumentSidebar } from './DocumentSidebar'
import { DocumentEditorHost } from './DocumentEditorHost'
import type { DetailSidebarTab } from './types/workspaceTypes'

interface DocumentWorkspaceProps {
  nodeId?: string
  value: unknown
  isDirty: boolean
  isContentLoaded?: boolean
  onChange: (value: unknown) => void
  onSave: () => Promise<void> | void
  attachmentCardPath: string | null
  detailHeader: ReactNode
  topoDocuments: TopoDocumentManifestItem[]
  trashTopoDocuments?: FSBTrashTopoDocumentItem[]
  activeDocumentPath: string
  detailSidebarTab?: DetailSidebarTab
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarTabChange?: (tab: DetailSidebarTab) => void
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onSelectDocument: (documentPath: string) => void
  onOpenDetailDocumentLink: (documentPath: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onRestoreDocument?: (trashName: string) => Promise<void> | void
  onClearTrashDocuments?: () => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
  isDocumentBusy?: boolean
}

export function DocumentWorkspace({
  value,
  isDirty,
  isContentLoaded,
  onChange,
  onSave,
  attachmentCardPath,
  detailHeader,
  topoDocuments,
  trashTopoDocuments = [],
  activeDocumentPath,
  detailSidebarTab,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarTabChange,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onSelectDocument,
  onOpenDetailDocumentLink,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onRestoreDocument,
  onClearTrashDocuments,
  onMoveDocument,
  isDocumentBusy,
}: DocumentWorkspaceProps) {
  const sidebarContent = (
    <DocumentSidebar
      topoDocuments={topoDocuments}
      trashTopoDocuments={trashTopoDocuments}
      activeDocumentPath={activeDocumentPath}
      isBusy={isDocumentBusy}
      onSelectDocument={onSelectDocument}
      onCreateTopoDocument={onCreateTopoDocument}
      onExportTopoDocument={onExportTopoDocument}
      onRenameDocument={onRenameDocument}
      onDeleteDocument={onDeleteDocument}
      onRestoreDocument={onRestoreDocument}
      onClearTrashDocuments={onClearTrashDocuments}
      onMoveDocument={onMoveDocument}
    />
  )

  return (
    <DocumentEditorHost
      value={value}
      isDirty={isDirty}
      isContentLoaded={isContentLoaded}
      onChange={onChange}
      onSave={onSave}
      attachmentCardPath={attachmentCardPath}
      detailHeader={detailHeader}
      documentsTabContent={sidebarContent}
      activeDetailDocumentPath={activeDocumentPath}
      detailSidebarTab={detailSidebarTab}
      onDetailSidebarTabChange={onDetailSidebarTabChange}
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      onOpenDetailDocumentLink={onOpenDetailDocumentLink}
      onCreateTopoDocument={onCreateTopoDocument}
      isDetailDocumentBusy={isDocumentBusy}
      topoDocuments={topoDocuments}
    />
  )
}
