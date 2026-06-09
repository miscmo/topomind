import type { GraphMeta } from '../../domain/graph/model'
import type { CardInfo } from '../../domain/graph/model'
import type { KBListItem } from '../../types'
import type {
  AttachmentUploadSyncContext,
  TrashItem,
  TrashTopoDocumentItem,
} from './local-types'
import type { TopoDocumentType } from '../topoDocumentTypes'

export interface VaultConfig {
  edgeDefaultsVersion?: number
  defaultEdgeStyle?: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
  defaultNodeStyle?: {
    headerFontSize?: number
    bodyFontSize?: number
    headerColor?: string
    headerBackgroundColor?: string
    headerFontWeight?: 'normal' | 'bold'
    headerFontStyle?: 'normal' | 'italic'
    borderColor?: string
    borderWidth?: number
    borderRadius?: number
  }
  defaultNodeSize?: { width?: number; height?: number }
  defaultEditorStyle?: {
    fontSize?: number
    fontFamily?: string
    backgroundColor?: string
    textColor?: string
    lineHeight?: number
  }
  nodeSizeLimits?: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }
  nodeBadgeSize?: number
  kbCovers?: Record<string, string>
  kbCoverOffsets?: Record<string, number>
  kbOrder?: string[]
  [key: string]: unknown
}

export interface TopoDocumentManifestItem {
  id: string
  type: TopoDocumentType
  title: string
  fileName: string
  parentId: string | null
  originalParentId?: string
  originalDocumentId?: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  version: number
}

export interface TopoDocumentManifest {
  version: 2
  documents: Record<string, TopoDocumentManifestItem>
}

export interface TopoDocumentCreateInput {
  type: TopoDocumentType
  title: string
  parentId?: string | null
}

export interface TopoDocumentRepairResult {
  repaired: boolean
  corrupted: boolean
  added: number
  removed: number
  documents: TopoDocumentManifestItem[]
}

export interface TopoDocumentExportPayload {
  fileName: string
  type: TopoDocumentType
  mimeType: string
  content: string
}

export interface AttachmentItem {
  name: string
  attachmentRef: string
  isImage: boolean
  size: number
  mtime: number
}

export interface VaultStorageBackend {
  createVault: (dirPath: string) => Promise<void>
  isValidVault: (dirPath: string) => Promise<{ valid: boolean; error?: string }>
}

export interface KnowledgeBaseStorageBackend {
  listKBs: () => Promise<KBListItem[]>
  listTrashKBs: () => Promise<TrashItem[]>
  restoreTrashKB: (trashName: string) => Promise<string>
  clearTrashKBs: () => Promise<void>
  createKB: (name: string) => Promise<void>
  deleteKB: (kbId: string) => Promise<void>
  renameKB: (kbId: string, newName: string) => Promise<void>
  importKB: (sourcePath: string) => Promise<string>
}

export interface CardStorageBackend {
  listCards: (parentRef: string) => Promise<CardInfo[]>
  createCard: (parentRef: string, name: string) => Promise<CardInfo>
  deleteCard: (cardRef: string) => Promise<void>
  renameCard: (cardRef: string, newName: string) => Promise<void>
}

export interface TopoDocumentStorageBackend {
  listTopoDocuments: (cardRef: string) => Promise<TopoDocumentManifestItem[]>
  createTopoDocument: (cardRef: string, input: TopoDocumentCreateInput) => Promise<TopoDocumentManifestItem>
  readTopoDocument: (cardRef: string, documentId: string) => Promise<unknown>
  writeTopoDocument: (cardRef: string, documentId: string, content: unknown) => Promise<void>
  renameTopoDocument: (cardRef: string, documentId: string, title: string) => Promise<TopoDocumentManifestItem>
  deleteTopoDocument: (cardRef: string, documentId: string) => Promise<void>
  listTrashTopoDocuments: (cardRef: string) => Promise<TrashTopoDocumentItem[]>
  restoreTrashTopoDocument: (cardRef: string, trashName: string) => Promise<TopoDocumentManifestItem>
  clearTrashTopoDocuments: (cardRef: string) => Promise<void>
  moveTopoDocument: (cardRef: string, documentId: string, newParentId: string | null, newSortOrder: number) => Promise<TopoDocumentManifestItem>
  repairTopoDocuments: (cardRef: string) => Promise<TopoDocumentRepairResult>
  exportTopoDocument: (cardRef: string, documentId: string) => Promise<TopoDocumentExportPayload>
  openTopoDocumentFolder: (cardRef: string, documentId: string) => Promise<boolean>
}

export interface AttachmentStorageBackend {
  listAttachments: (cardRef: string) => Promise<AttachmentItem[]>
  importAttachment: (
    cardRef: string,
    sourceFilePath: string,
    targetFileName?: string,
    syncContext?: AttachmentUploadSyncContext,
    uploadTicketJson?: Record<string, unknown>,
  ) => Promise<string>
  deleteAttachment: (cardRef: string, attachmentName: string) => Promise<void>
  listTrashAttachments: (cardRef: string) => Promise<TrashItem[]>
  restoreTrashAttachment: (cardRef: string, trashName: string) => Promise<string>
  clearTrashAttachments: (cardRef: string) => Promise<void>
  openAttachment: (cardRef: string, attachmentRef: string) => Promise<boolean>
  showAttachmentInFolder: (cardRef: string, attachmentRef: string) => Promise<boolean>
  getAttachmentAbsoluteUrl: (cardRef: string, attachmentRef: string) => Promise<string | null>
  writeAttachmentBase64: (
    cardRef: string,
    fileName: string,
    mimeType: string,
    base64: string,
    syncContext?: AttachmentUploadSyncContext,
    uploadTicketJson?: Record<string, unknown>,
  ) => Promise<string>
  downloadAttachment: (
    cardRef: string,
    url: string,
    targetFileName?: string,
    syncContext?: AttachmentUploadSyncContext,
    uploadTicketJson?: Record<string, unknown>,
  ) => Promise<string>
  readAttachmentDataUrl: (cardRef: string, attachmentRef: string) => Promise<string>
}

export interface GraphLayoutStorageBackend {
  readLayout: (roomRef: string) => Promise<GraphMeta>
  writeLayout: (roomRef: string, meta: GraphMeta) => Promise<void>
}

export interface ConfigStorageBackend {
  readConfig: () => Promise<unknown>
  writeConfig: (content: unknown) => Promise<void>
}

export interface StorageBackend extends
  VaultStorageBackend,
  KnowledgeBaseStorageBackend,
  CardStorageBackend,
  TopoDocumentStorageBackend,
  AttachmentStorageBackend,
  GraphLayoutStorageBackend,
  ConfigStorageBackend {}
