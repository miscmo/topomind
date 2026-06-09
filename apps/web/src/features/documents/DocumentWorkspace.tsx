import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import type { TrashTopoDocumentItem } from '../../core/storage'
import { DocumentSidebar } from './DocumentSidebar'
import { DocumentEditorHost } from './DocumentEditorHost'
import type { DetailSidebarTab, DocumentSyncStatus } from './types/workspaceTypes'

interface DocumentWorkspaceProps {
  nodeId?: string
  readOnly?: boolean
  editorReadOnly?: boolean
  value: unknown
  isDirty: boolean
  syncStatus?: DocumentSyncStatus | null
  isContentLoaded?: boolean
  onChange: (value: unknown) => void
  onSave: () => Promise<void> | void
  attachmentCardRef: string | null
  detailHeader: ReactNode
  topoDocuments: TopoDocumentManifestItem[]
  trashTopoDocuments?: TrashTopoDocumentItem[]
  activeDocumentKey: string
  detailSidebarTab?: DetailSidebarTab
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarTabChange?: (tab: DetailSidebarTab) => void
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onSelectDocument: (documentKey: string) => void
  onOpenDetailDocumentLink: (documentKey: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentKey: string) => void
  onRenameDocument: (documentKey: string, name: string) => void
  onDeleteDocument: (documentKey: string) => void
  onRestoreDocument?: (trashName: string) => Promise<void> | void
  onClearTrashDocuments?: () => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
  isDocumentBusy?: boolean
}

export function DocumentWorkspace({
  readOnly = false,
  editorReadOnly = readOnly,
  value,
  isDirty,
  syncStatus,
  isContentLoaded,
  onChange,
  onSave,
  attachmentCardRef,
  detailHeader,
  topoDocuments,
  trashTopoDocuments = [],
  activeDocumentKey,
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
      readOnly={readOnly}
      topoDocuments={topoDocuments}
      trashTopoDocuments={trashTopoDocuments}
      activeDocumentKey={activeDocumentKey}
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
      readOnly={editorReadOnly}
      value={value}
      isDirty={isDirty}
      syncStatus={syncStatus}
      isContentLoaded={isContentLoaded}
      onChange={onChange}
      onSave={onSave}
      attachmentCardRef={attachmentCardRef}
      detailHeader={detailHeader}
      documentsTabContent={sidebarContent}
      activeDetailDocumentKey={activeDocumentKey}
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
