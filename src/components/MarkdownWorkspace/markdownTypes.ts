export type MarkdownDocumentType = 'detail' | 'card'
export type MarkdownViewMode = 'edit' | 'preview'

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
}
