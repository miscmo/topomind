import type { ReactNode } from 'react'
import type { TopoDocumentManifestItem } from '../../../core/storage'

export type DocumentType = 'detail' | 'card' | 'canvas'
export type DetailSidebarTab = 'documents' | 'toc' | 'attachments'
export type DocumentSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

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
  isDirty: boolean
  onChange: (value: unknown) => void
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
  detailSidebarTab?: DetailSidebarTab
  onDetailSidebarTabChange?: (tab: DetailSidebarTab) => void
  tocItems?: TocItem[]
  onTocItemClick?: (item: TocItem) => void
  editorContent?: ReactNode
  statusBarContent?: ReactNode
  renderStatusBar?: (state: { saveStatus: DocumentSaveStatus; lastSavedAt: number | null; saveError: string | null }) => ReactNode
}
