import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem } from '../../core/storage'

export type DocumentType = 'detail' | 'card' | 'canvas'
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

export interface DocumentWorkspaceLayoutProps {
  value: string
  savedValue: string
  onChange: (value: string) => void
  onSave: () => Promise<void> | void
  onCancel?: () => void
  attachmentCardPath: string | null
  documentType: DocumentType
  detailSidebarCollapsed?: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange?: (collapsed: boolean) => void
  onSidebarHoverChange?: (hovered: boolean) => void
  detailHeader?: ReactNode
  documentsTabContent?: ReactNode
  activeDetailDocumentPath?: string
  tocItems?: TocItem[]
  onTocItemClick?: (item: TocItem) => void
  editorContent?: ReactNode
}
