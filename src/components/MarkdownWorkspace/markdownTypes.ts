import type { ReactNode } from 'react'
import type { DetailDocumentItem } from '../../core/storage'

export type MarkdownDocumentType = 'detail' | 'card'
export type MarkdownViewMode = 'edit' | 'preview'
export type DetailSidebarTab = 'documents' | 'toc' | 'attachments'

export interface MarkdownWorkspaceProps {
  value: string
  savedValue: string
  onChange: (value: string) => void
  onSave: () => Promise<void> | void
  onCancel?: () => void
  attachmentCardPath: string | null
  documentType: MarkdownDocumentType
  placeholder?: string
  previewClassName?: string
  title?: string
  pathLabel?: string
  detailHeader?: ReactNode
  detailDocuments?: DetailDocumentItem[]
  activeDetailDocumentPath?: string
  detailSidebarCollapsed?: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange?: (collapsed: boolean) => void
  onSidebarHoverChange?: (hovered: boolean) => void
  viewMode?: MarkdownViewMode
  onViewModeChange?: (mode: MarkdownViewMode) => void
  showToolbar?: boolean
  onSelectDetailDocument?: (documentPath: string) => void
  onOpenDetailDocumentLink?: (documentPath: string) => void
  onCreateDetailDocument?: (name: string) => void
  onRenameDetailDocument?: (documentPath: string, name: string) => void
  onDeleteDetailDocument?: (documentPath: string) => void
  isDetailDocumentBusy?: boolean
}
