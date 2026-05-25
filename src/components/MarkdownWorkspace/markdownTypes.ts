import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem } from '../../core/storage'

export type MarkdownDocumentType = 'detail' | 'card' | 'canvas'
export type MarkdownViewMode = 'edit' | 'preview' | 'split'
export type DetailSidebarTab = 'documents' | 'toc' | 'attachments'

export interface TocItem {
  id: string
  level: number
  text: string
  line: number
}

export interface DocumentContextMenuState {
  x: number
  y: number
  targetId: string | null
}

export interface DocumentInlineEditState {
  mode: 'create' | 'createTopoSmart' | 'createTopoMindMap' | 'createTopoFlowchart' | 'rename'
  targetId: string | null
  parentId: string | null
  value: string
}

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
  detailSidebarCollapsed?: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange?: (collapsed: boolean) => void
  onSidebarHoverChange?: (hovered: boolean) => void
  detailHeader?: ReactNode
  documentsTabContent?: ReactNode
  activeDetailDocumentPath?: string
  viewMode?: MarkdownViewMode
  onViewModeChange?: (mode: MarkdownViewMode) => void
  onOpenDetailDocumentLink?: (documentPath: string) => void
  tocItems?: TocItem[]
  onTocItemClick?: (item: TocItem) => void
  showToolbar?: boolean
  editorContent?: ReactNode
}
