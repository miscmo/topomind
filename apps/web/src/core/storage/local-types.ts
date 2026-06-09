import type { TopoDocumentType } from '../topoDocumentTypes'

export interface TrashItem {
  trashName: string
  originalName: string
  originalPath: string
  deletedAt: number
  size: number
  isDirectory: boolean
}

export interface TrashTopoDocumentItem extends TrashItem {
  documentId: string
  title: string
  type: TopoDocumentType
}

export type AttachmentUploadSyncContext =
  | {
      workspaceId: string
      cardId: string
      knowledgeBaseId?: never
      documentId?: string | null
    }
  | {
      workspaceId: string
      knowledgeBaseId: string
      cardId?: never
      documentId?: never
    }
