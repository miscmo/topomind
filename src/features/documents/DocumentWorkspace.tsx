import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
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
  /** 关联视图传入自定义侧栏列表；缺省渲染本节点的文档树。 */
  documentsTabContent?: ReactNode
  topoDocuments: TopoDocumentManifestItem[]
  activeDocumentPath: string
  detailSidebarTab?: DetailSidebarTab
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarTabChange?: (tab: DetailSidebarTab) => void
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onSelectDocument: (documentPath: string) => void
  /** 正文 docLink chip 点击：按 docId 在右栏打开目标文档。 */
  onOpenDocumentByDocId: (docId: string) => void
  /** 「被引用」侧栏页内容。 */
  backlinksTabContent?: ReactNode
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
  onMoveDocumentToCard?: (documentId: string) => void
  onUpdateDocumentMeta?: (documentPath: string, patch: { icon?: string | null; color?: string | null }) => void
  isDocumentBusy?: boolean
}

export function DocumentWorkspace({
  nodeId,
  value,
  isDirty,
  isContentLoaded,
  onChange,
  onSave,
  attachmentCardPath,
  detailHeader,
  documentsTabContent,
  topoDocuments,
  activeDocumentPath,
  detailSidebarTab,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarTabChange,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onSelectDocument,
  onOpenDocumentByDocId,
  backlinksTabContent,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
  onMoveDocumentToCard,
  onUpdateDocumentMeta,
  isDocumentBusy,
}: DocumentWorkspaceProps) {
  const sidebarContent = useMemo(() => documentsTabContent ?? (
    <DocumentSidebar
      key={nodeId ?? 'document-sidebar'}
      nodeId={nodeId}
      topoDocuments={topoDocuments}
      activeDocumentPath={activeDocumentPath}
      isBusy={isDocumentBusy}
      onSelectDocument={onSelectDocument}
      onCreateTopoDocument={onCreateTopoDocument}
      onExportTopoDocument={onExportTopoDocument}
      onRenameDocument={onRenameDocument}
      onDeleteDocument={onDeleteDocument}
      onMoveDocument={onMoveDocument}
      onMoveDocumentToCard={onMoveDocumentToCard}
      onUpdateDocumentMeta={onUpdateDocumentMeta}
    />
  ), [documentsTabContent, nodeId, topoDocuments, activeDocumentPath, isDocumentBusy, onSelectDocument, onCreateTopoDocument, onExportTopoDocument, onRenameDocument, onDeleteDocument, onMoveDocument, onMoveDocumentToCard, onUpdateDocumentMeta])

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
      onOpenDocumentByDocId={onOpenDocumentByDocId}
      backlinksTabContent={backlinksTabContent}
      onCreateTopoDocument={onCreateTopoDocument}
      isDetailDocumentBusy={isDocumentBusy}
      topoDocuments={topoDocuments}
      nodeId={nodeId}
    />
  )
}
