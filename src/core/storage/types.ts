import type { GraphMeta } from '../../domain/graph/model'
import type { CardInfo } from '../../domain/graph/model'
import type { KBListItem } from '../../types'
import type { FSBTrashItem, FSBTrashTopoDocumentItem } from '../fs-backend'
import type { TopoDocumentType } from '../topoDocumentTypes'

export interface VaultConfig {
  edgeDefaultsVersion?: number
  defaultEdgeStyle?: {
    lineMode?: 'smoothstep' | 'straight'
    lineStyle?: 'solid' | 'dashed'
    color?: string
    lineWidth?: number
    arrow?: boolean
    arrowSize?: number
    arrowShape?: 'solid' | 'hollow'
    arrowPosition?: 'end' | 'start' | 'both'
  }
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
  /** 自定义文档图标（emoji 字符），未设置时按 type 显示默认图标 */
  icon?: string
  /** 自定义文档列表标题颜色（hex，如 #e74c3c），未设置时跟随主题 */
  color?: string
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

/** 文档元数据可更新字段（图标/标题颜色），支持置空（'' 清除自定义值） */
export interface TopoDocumentMetaPatch {
  icon?: string | null
  color?: string | null
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

/** 跨节点移动文档的返回结果（含子文档与附件统计）。 */
export interface MoveTopoDocumentToCardResult {
  moved: TopoDocumentManifestItem[]
  targetCardPath: string
  movedCount: number
  attachmentCount: number
  /** 源节点中被清理的孤儿附件数量（被移动文档引用、且其他活动文档不再引用） */
  attachmentCleaned: number
}

/** 跨房间移动节点的返回结果。 */
export interface MoveTopoNodesToRoomResult {
  /** 移动后在目标房间中的节点 basename 列表（含自动改名后的新名） */
  moved: string[]
  /** 随节点保留并迁入目标房间的内部连线数量（两端都在被移动集合中） */
  keptEdges: number
  /** 因跨越边界被丢弃的连线数量（一端在被移动集合、一端在源房间其余节点） */
  droppedEdges: number
  targetRoomPath: string
  sourceRoomPath: string
  /** 旧 basename → 新 basename 的改名映射（目标房间同名冲突时产生） */
  renamed: Record<string, string>
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
  listAllTrashItems: () => Promise<FSBTrashItem[]>
  restoreGlobalTrashItem: (category: string, trashName: string) => Promise<any>
  clearAllTrashItems: () => Promise<void>
}

export interface CardStorageBackend {
  listCards: (parentCardPath: string) => Promise<CardInfo[]>
  createCard: (parentPath: string, name: string) => Promise<CardInfo>
  deleteCard: (cardPath: string, label?: string) => Promise<void>
  renameCard: (cardPath: string, newName: string) => Promise<void>
}

export interface TopoDocumentStorageBackend {
  listTopoDocuments: (cardPath: string) => Promise<TopoDocumentManifestItem[]>
  createTopoDocument: (cardPath: string, input: TopoDocumentCreateInput) => Promise<TopoDocumentManifestItem>
  readTopoDocument: (cardPath: string, documentId: string) => Promise<unknown>
  writeTopoDocument: (cardPath: string, documentId: string, content: unknown) => Promise<void>
  renameTopoDocument: (cardPath: string, documentId: string, title: string) => Promise<TopoDocumentManifestItem>
  updateTopoDocumentMeta: (cardPath: string, documentId: string, patch: TopoDocumentMetaPatch) => Promise<TopoDocumentManifestItem>
  deleteTopoDocument: (cardPath: string, documentId: string) => Promise<void>
  listTrashTopoDocuments: (cardPath: string) => Promise<FSBTrashTopoDocumentItem[]>
  restoreTrashTopoDocument: (cardPath: string, trashName: string) => Promise<TopoDocumentManifestItem>
  clearTrashTopoDocuments: (cardPath: string) => Promise<void>
  moveTopoDocument: (cardPath: string, documentId: string, newParentId: string | null, newSortOrder: number) => Promise<TopoDocumentManifestItem>
  moveTopoDocumentToCard: (cardPath: string, documentId: string, targetCardPath: string) => Promise<MoveTopoDocumentToCardResult>
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
  showAttachmentInFolder: (cardPath: string, attachmentRef: string) => Promise<boolean>
  getAttachmentAbsoluteUrl: (cardPath: string, attachmentRef: string) => Promise<string | null>
  writeAttachmentBase64: (cardPath: string, fileName: string, mimeType: string, base64: string) => Promise<string>
  downloadAttachment: (cardPath: string, url: string, targetFileName?: string) => Promise<string>
  readAttachmentDataUrl: (cardPath: string, attachmentRef: string) => Promise<string>
}

export interface RoomNodeSummary {
  position?: { x: number; y: number }
  childCount: number
  hasDetail: boolean
}

export interface GraphLayoutStorageBackend {
  readLayout: (roomPath: string) => Promise<GraphMeta>
  readRoomNodeSummaries: (roomPaths: string[]) => Promise<Record<string, RoomNodeSummary>>
  writeLayout: (roomPath: string, meta: GraphMeta) => Promise<void>
}

/** 跨房间移动节点（批量），由后端原子操作完成物理 relocate 与连线重分配。 */
export interface NodeMoveStorageBackend {
  moveTopoNodesToRoom: (
    sourceRoomPath: string,
    nodeIds: string[],
    targetRoomPath: string
  ) => Promise<MoveTopoNodesToRoomResult>
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
  NodeMoveStorageBackend,
  ConfigStorageBackend {}
