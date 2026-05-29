import type { GraphMeta } from '../../domain/graph/model'
import type { CardInfo } from '../../domain/graph/model'
import type { KBListItem } from '../../types'
import type { FSBTrashItem, FSBTrashTopoDocumentItem } from '../fs-backend'
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
  path: string
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
  path: string
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
  listTrashKBs: () => Promise<FSBTrashItem[]>
  restoreTrashKB: (trashName: string) => Promise<string>
  clearTrashKBs: () => Promise<void>
  createKB: (name: string) => Promise<void>
  deleteKB: (kbPath: string) => Promise<void>
  renameKB: (kbPath: string, newName: string) => Promise<void>
  importKB: (sourcePath: string) => Promise<string>
}

export interface CardStorageBackend {
  listCards: (parentCardPath: string) => Promise<CardInfo[]>
  createCard: (parentPath: string, name: string) => Promise<CardInfo>
  deleteCard: (cardPath: string) => Promise<void>
  renameCard: (cardPath: string, newName: string) => Promise<void>
}

export interface TopoDocumentStorageBackend {
  listTopoDocuments: (cardPath: string) => Promise<TopoDocumentManifestItem[]>
  createTopoDocument: (cardPath: string, input: TopoDocumentCreateInput) => Promise<TopoDocumentManifestItem>
  readTopoDocument: (cardPath: string, documentId: string) => Promise<unknown>
  writeTopoDocument: (cardPath: string, documentId: string, content: unknown) => Promise<void>
  renameTopoDocument: (cardPath: string, documentId: string, title: string) => Promise<TopoDocumentManifestItem>
  deleteTopoDocument: (cardPath: string, documentId: string) => Promise<void>
  listTrashTopoDocuments: (cardPath: string) => Promise<FSBTrashTopoDocumentItem[]>
  restoreTrashTopoDocument: (cardPath: string, trashName: string) => Promise<TopoDocumentManifestItem>
  clearTrashTopoDocuments: (cardPath: string) => Promise<void>
  moveTopoDocument: (cardPath: string, documentId: string, newParentId: string | null, newSortOrder: number) => Promise<TopoDocumentManifestItem>
  repairTopoDocuments: (cardPath: string) => Promise<TopoDocumentRepairResult>
  exportTopoDocument: (cardPath: string, documentId: string) => Promise<TopoDocumentExportPayload>
  openTopoDocumentFolder: (cardPath: string, documentId: string) => Promise<boolean>
}

export interface AttachmentStorageBackend {
  listAttachments: (cardPath: string) => Promise<AttachmentItem[]>
  importAttachment: (cardPath: string, sourceFilePath: string, targetFileName?: string) => Promise<string>
  deleteAttachment: (cardPath: string, attachmentName: string) => Promise<void>
  listTrashAttachments: (cardPath: string) => Promise<FSBTrashItem[]>
  restoreTrashAttachment: (cardPath: string, trashName: string) => Promise<string>
  clearTrashAttachments: (cardPath: string) => Promise<void>
  openAttachment: (cardPath: string, attachmentRef: string) => Promise<boolean>
  getAttachmentAbsoluteUrl: (cardPath: string, attachmentRef: string) => Promise<string | null>
  writeAttachmentBase64: (cardPath: string, fileName: string, mimeType: string, base64: string) => Promise<string>
  downloadAttachment: (cardPath: string, url: string, targetFileName?: string) => Promise<string>
  readAttachmentDataUrl: (cardPath: string, attachmentRef: string) => Promise<string>
}

export interface GraphLayoutStorageBackend {
  readLayout: (roomPath: string) => Promise<GraphMeta>
  writeLayout: (roomPath: string, meta: GraphMeta) => Promise<void>
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
