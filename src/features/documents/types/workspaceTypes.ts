import type { ReactNode } from 'react'

export type DocumentType = 'detail' | 'card' | 'canvas'
export type DetailSidebarTab = 'documents' | 'attachments'
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
  // 当前滚动位置所在的标题 block id，用于目录选中态高亮（scroll-spy）
  activeTocId?: string | null
  editorContent?: ReactNode
  statusBarContent?: ReactNode
  renderStatusBar?: (state: { saveStatus: DocumentSaveStatus; lastSavedAt: number | null; saveError: string | null }) => ReactNode
}
