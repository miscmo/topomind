import { cloudApi, getCloudSessionSnapshot } from '../cloud-api'
import { refreshAccessToken } from '../http-client'
import { inferMimeTypeFromFileName, normalizeAttachmentMimeType } from '../attachment-upload-ticket'
import { LocalDB } from '../localdb-backend'
import { createLocalDbGraphStorage } from '../localdb-graph'
import { dispatchCloudLocalDbUpdated, syncWorkspacePullIntoLocalMirror } from '../../application/cloud/localdb-sync'
import { normalizeRef, resolveRoomChildRef } from '../../domain/graph/path-utils'
import { isTopoDocumentType } from '../topoDocumentTypes'
import type { StorageBackend, TopoDocumentCreateInput, TopoDocumentManifestItem } from './service'
import type {
  LocalAttachmentRecord,
  LocalDocumentRecord,
  LocalWorkspaceSnapshot,
} from '../../types/local-sync'
import type { CardInfo, GraphMeta } from '../../domain/graph/model'

function toUnixTime(value: string | null) {
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function mapLocalDocumentToManifestItem(document: LocalDocumentRecord): TopoDocumentManifestItem | null {
  if (!isTopoDocumentType(document.type)) {
    return null
  }
  return {
    id: document.id,
    type: document.type,
    title: document.title,
    fileName: document.fileName,
    parentId: document.parentDocumentId,
    sortOrder: document.sortOrder,
    createdAt: toUnixTime(document.createdAt),
    updatedAt: toUnixTime(document.updatedAt),
    version: document.version,
  }
}

function mapLocalDocumentToTrashItem(document: LocalDocumentRecord) {
  if (!isTopoDocumentType(document.type) || !document.deletedAt) {
    return null
  }
  return {
    trashName: document.id,
    originalName: document.title,
    originalPath: document.fileName,
    deletedAt: toUnixTime(document.deletedAt),
    size: 0,
    isDirectory: false,
    documentId: document.id,
    title: document.title,
    type: document.type,
  }
}

function unsupported(message: string): never {
  throw new Error(message)
}

function getCardIdFromRef(cardRef: string) {
  const normalized = normalizeRef(cardRef)
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : null
}

async function fetchWorkspaceSnapshot(workspaceId: string) {
  return LocalDB.getWorkspaceSnapshot(workspaceId)
}

function resolveKnowledgeBaseId(
  snapshot: LocalWorkspaceSnapshot,
  kbIdOrName: string,
) {
  const normalized = String(kbIdOrName || '').trim()
  const matched =
    snapshot.knowledgeBases.find((item) => item.id === normalized)
    ?? snapshot.knowledgeBases.find((item) => item.name === normalized)
  if (!matched) {
    throw new Error(`未找到知识库: ${kbIdOrName}`)
  }
  return matched.id
}

function resolveAttachmentRecord(
  snapshot: LocalWorkspaceSnapshot,
  cardRef: string,
  attachmentRef: string,
): LocalAttachmentRecord | null {
  const cardId = getCardIdFromRef(cardRef)
  const normalizedRef = String(attachmentRef || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
  const fileName = normalizedRef.startsWith('_attach/')
    ? normalizedRef.slice('_attach/'.length)
    : normalizedRef.split('/').pop() || normalizedRef

  return (
    snapshot.attachments.find(
      (item) =>
        !item.deletedAt
        && item.fileName === fileName
        && (cardId ? item.cardId === cardId : true),
    ) ?? null
  )
}

async function ensureAccessToken() {
  const session = getCloudSessionSnapshot()
  if (session.accessToken) {
    return session.accessToken
  }
  if (!session.refreshToken) {
    throw new Error('当前没有可用的云端访问令牌')
  }
  return refreshAccessToken(session.refreshToken)
}

async function fetchAttachmentBlob(
  workspaceId: string,
  attachmentId: string,
) {
  let accessToken = await ensureAccessToken()
  let response = await fetch(
    `${cloudApi.getBaseUrl()}/workspaces/${workspaceId}/attachments/${attachmentId}/content`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    },
  )
  if (response.status === 401) {
    const session = getCloudSessionSnapshot()
    if (!session.refreshToken) {
      throw new Error('当前没有可用的云端访问令牌')
    }
    accessToken = await refreshAccessToken(session.refreshToken)
    response = await fetch(
      `${cloudApi.getBaseUrl()}/workspaces/${workspaceId}/attachments/${attachmentId}/content`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
    )
  }
  if (!response.ok) {
    throw new Error(`读取附件失败: ${response.status}`)
  }
  return response.blob()
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'))
    reader.readAsDataURL(blob)
  })
}

function decodeBase64ToUint8Array(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function computeSha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function toCardInfo(parentRef: string, cardId: string, name: string, updatedAt?: string): CardInfo {
  return {
    ref: resolveRoomChildRef(parentRef, cardId),
    name,
    updatedAt,
  }
}

function extractCommittedAttachment(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const response = payload as {
    ok?: boolean
    data?: {
      attachment?: {
        id?: string
        fileName?: string
      }
    }
  }
  const attachment = response.data?.attachment
  if (!attachment?.id || !attachment.fileName) {
    return null
  }
  return {
    id: attachment.id,
    fileName: attachment.fileName,
  }
}

export function createRemoteStorageBackend(workspaceId: string): StorageBackend {
  const graphStorage = createLocalDbGraphStorage(workspaceId)
  const attachmentUrlCache = new Map<string, string>()

  const getSnapshot = () => fetchWorkspaceSnapshot(workspaceId)

  const refreshSnapshot = async () => {
    const snapshot = await syncWorkspacePullIntoLocalMirror(workspaceId)
    dispatchCloudLocalDbUpdated(workspaceId, snapshot.cursor.lastEventId)
    return snapshot
  }

  return {
    async createVault() {
      unsupported('云端模式不支持创建本地工作目录')
    },

    async isValidVault() {
      return { valid: false, error: '云端模式不支持选择本地工作目录' }
    },

    async listKBs() {
      const snapshot = await getSnapshot()
      return snapshot.knowledgeBases
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'))
        .map((item) => ({ name: item.name }))
    },

    async listTrashKBs() {
      const snapshot = await getSnapshot()
      return snapshot.knowledgeBases
        .filter((item) => Boolean(item.deletedAt))
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .map((item) => ({
          trashName: item.id,
          originalName: item.name,
          originalPath: item.name,
          deletedAt: toUnixTime(item.deletedAt),
          size: 0,
          isDirectory: true,
        }))
    },

    async restoreTrashKB(trashName: string) {
      const restored = await cloudApi.restoreWorkspaceKnowledgeBase(workspaceId, trashName)
      await refreshSnapshot()
      return restored.name
    },

    async clearTrashKBs() {
      const snapshot = await getSnapshot()
      for (const item of snapshot.knowledgeBases.filter((kb) => Boolean(kb.deletedAt))) {
        await cloudApi.purgeWorkspaceKnowledgeBase(workspaceId, item.id)
      }
      await refreshSnapshot()
    },

    async createKB(name: string) {
      await cloudApi.createWorkspaceKnowledgeBase(workspaceId, { name, sortOrder: 0 })
      await refreshSnapshot()
    },

    async deleteKB(kbIdOrName: string) {
      const snapshot = await getSnapshot()
      const kbId = resolveKnowledgeBaseId(snapshot, kbIdOrName)
      await cloudApi.deleteWorkspaceKnowledgeBase(workspaceId, kbId)
      await refreshSnapshot()
    },

    async renameKB(kbIdOrName: string, newName: string) {
      const snapshot = await getSnapshot()
      const kbId = resolveKnowledgeBaseId(snapshot, kbIdOrName)
      await cloudApi.updateWorkspaceKnowledgeBase(workspaceId, kbId, { name: newName })
      await refreshSnapshot()
    },

    async importKB() {
      unsupported('Web 版知识库导入仍待实现')
    },

    async listCards(parentRef: string) {
      const snapshot = await getSnapshot()
      const normalizedRef = normalizeRef(parentRef)
      const parts = normalizedRef.split('/').filter(Boolean)
      if (parts.length === 0) {
        return []
      }
      const kbId = parts[0]
      const parentId = parts.length > 1 ? parts[parts.length - 1] : null
      return snapshot.cards
        .filter(
          (item) =>
            !item.deletedAt
            && item.kbId === kbId
            && (item.parentId ?? null) === parentId,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'))
        .map((item) => ({
          ref: resolveRoomChildRef(parentRef, item.id),
          name: item.name,
          updatedAt: item.updatedAt,
        }))
    },

    async createCard(parentRef: string, name: string) {
      const cardId = await graphStorage.createCard(parentRef, name)
      return toCardInfo(parentRef, cardId, name)
    },
    async deleteCard(cardRef: string) {
      await graphStorage.deleteCard(cardRef)
    },
    async renameCard(cardRef: string, newName: string) {
      await graphStorage.renameCard(cardRef, newName)
    },
    readLayout: graphStorage.readLayout,
    writeLayout: graphStorage.writeLayout,

    async listTopoDocuments(cardRef: string) {
      const items = await graphStorage.listTopoDocuments(cardRef)
      return items
        .map(mapLocalDocumentToManifestItem)
        .filter((item): item is TopoDocumentManifestItem => item !== null)
    },

    async createTopoDocument(cardRef: string, input: TopoDocumentCreateInput) {
      const cardId = getCardIdFromRef(cardRef)
      if (!cardId) {
        throw new Error('无法识别文档所属卡片')
      }
      const documents = await graphStorage.listTopoDocuments(cardRef)
      const siblingCount = documents.filter(
        (item) => (item.parentDocumentId ?? null) === (input.parentId ?? null),
      ).length
      const created = await LocalDB.createDocument({
        workspaceId,
        cardId,
        type: input.type,
        title: input.title,
        parentDocumentId: input.parentId ?? null,
        sortOrder: siblingCount,
      })
      const manifestItem = mapLocalDocumentToManifestItem(created)
      if (!manifestItem) {
        throw new Error(`创建的文档类型不受支持: ${created.type}`)
      }
      return manifestItem
    },

    async readTopoDocument(_cardRef: string, documentId: string) {
      const document = await LocalDB.getDocument(documentId)
      if (!document) {
        throw new Error(`未找到文档: ${documentId}`)
      }
      return document.contentJson
    },

    async writeTopoDocument(_cardRef: string, documentId: string, content: unknown) {
      await LocalDB.updateDocumentContent({
        documentId,
        contentJson:
          content && typeof content === 'object' && !Array.isArray(content)
            ? (content as Record<string, unknown>)
            : {},
      })
    },

    async renameTopoDocument(_cardRef: string, documentId: string, title: string) {
      const updated = await LocalDB.updateDocument({
        documentId,
        title,
      })
      const manifestItem = mapLocalDocumentToManifestItem(updated)
      if (!manifestItem) {
        throw new Error(`重命名后的文档类型不受支持: ${updated.type}`)
      }
      return manifestItem
    },

    async deleteTopoDocument(_cardRef: string, documentId: string) {
      await LocalDB.deleteDocument({ documentId })
    },

    async listTrashTopoDocuments(cardRef: string) {
      const cardId = getCardIdFromRef(cardRef)
      if (!cardId) {
        return []
      }
      const snapshot = await getSnapshot()
      return snapshot.documents
        .filter((item) => Boolean(item.deletedAt) && item.cardId === cardId)
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .map(mapLocalDocumentToTrashItem)
        .filter((item): item is NonNullable<typeof item> => item !== null)
    },

    async restoreTrashTopoDocument(_cardRef: string, trashName: string) {
      const restored = await LocalDB.restoreDocument({ documentId: trashName })
      const manifestItem = mapLocalDocumentToManifestItem(restored)
      if (!manifestItem) {
        throw new Error(`恢复后的文档类型不受支持: ${restored.type}`)
      }
      return manifestItem
    },

    async clearTrashTopoDocuments(cardRef: string) {
      const items = await this.listTrashTopoDocuments(cardRef)
      for (const item of items) {
        await LocalDB.purgeDocument({ documentId: item.documentId })
      }
    },

    async moveTopoDocument(_cardRef: string, documentId: string, newParentId: string | null, newSortOrder: number) {
      const updated = await LocalDB.updateDocument({
        documentId,
        parentDocumentId: newParentId,
        sortOrder: newSortOrder,
      })
      const manifestItem = mapLocalDocumentToManifestItem(updated)
      if (!manifestItem) {
        throw new Error(`移动后的文档类型不受支持: ${updated.type}`)
      }
      return manifestItem
    },

    async repairTopoDocuments(cardRef: string) {
      const documents = await this.listTopoDocuments(cardRef)
      return {
        repaired: false,
        corrupted: false,
        added: 0,
        removed: 0,
        documents,
      }
    },

    async exportTopoDocument(_cardRef: string, documentId: string) {
      const document = await LocalDB.getDocument(documentId)
      if (!document) {
        throw new Error(`未找到文档: ${documentId}`)
      }
      return {
        fileName: document.fileName,
        type: isTopoDocumentType(document.type) ? document.type : 'smart',
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(document.contentJson ?? {}, null, 2),
      }
    },

    async openTopoDocumentFolder() {
      return false
    },

    async listAttachments(cardRef: string) {
      const cardId = getCardIdFromRef(cardRef)
      if (!cardId) {
        return []
      }
      const records = await LocalDB.listAttachmentsByCard(workspaceId, cardId)
      return records
        .filter((item) => !item.deletedAt)
        .map((item) => ({
          name: item.fileName,
          attachmentRef: `_attach/${item.fileName}`,
          isImage: item.mimeType.startsWith('image/'),
          size: item.sizeBytes,
          mtime: toUnixTime(item.updatedAt),
        }))
    },

    async importAttachment() {
      unsupported('Web 版暂不支持从本机路径导入附件，请改用浏览器文件选择上传')
    },

    async deleteAttachment(cardRef: string, attachmentName: string) {
      const snapshot = await getSnapshot()
      const record = resolveAttachmentRecord(snapshot, cardRef, attachmentName)
      if (!record) {
        throw new Error(`未找到附件: ${attachmentName}`)
      }
      await LocalDB.deleteAttachment({ attachmentId: record.id })
    },

    async listTrashAttachments(cardRef: string) {
      const cardId = getCardIdFromRef(cardRef)
      if (!cardId) {
        return []
      }
      const records = await LocalDB.listAttachmentsByCard(workspaceId, cardId)
      return records
        .filter((item) => Boolean(item.deletedAt))
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .map((item) => ({
          trashName: item.id,
          originalName: item.fileName,
          originalPath: item.fileName,
          deletedAt: toUnixTime(item.deletedAt),
          size: item.sizeBytes,
          isDirectory: false,
        }))
    },

    async restoreTrashAttachment(_cardRef: string, trashName: string) {
      const restored = await LocalDB.restoreAttachment({ attachmentId: trashName })
      return `_attach/${restored.fileName}`
    },

    async clearTrashAttachments(cardRef: string) {
      const items = await this.listTrashAttachments(cardRef)
      for (const item of items) {
        await LocalDB.purgeAttachment({ attachmentId: item.trashName })
      }
    },

    async openAttachment(cardRef: string, attachmentRef: string) {
      const url = await this.getAttachmentAbsoluteUrl(cardRef, attachmentRef)
      if (!url) {
        return false
      }
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    },

    async showAttachmentInFolder(cardRef: string, attachmentRef: string) {
      return this.openAttachment(cardRef, attachmentRef)
    },

    async getAttachmentAbsoluteUrl(cardRef: string, attachmentRef: string) {
      const snapshot = await getSnapshot()
      const record = resolveAttachmentRecord(snapshot, cardRef, attachmentRef)
      if (!record) {
        return null
      }
      const cacheKey = `${record.id}:${record.updatedAt}`
      const cachedUrl = attachmentUrlCache.get(cacheKey)
      if (cachedUrl) {
        return cachedUrl
      }
      const blob = await fetchAttachmentBlob(workspaceId, record.id)
      const url = URL.createObjectURL(blob)
      attachmentUrlCache.set(cacheKey, url)
      return url
    },

    async writeAttachmentBase64(cardRef: string, fileName: string, mimeType: string, base64: string) {
      const cardId = getCardIdFromRef(cardRef)
      if (!cardId) {
        throw new Error('无法识别附件所属卡片')
      }
      const normalizedMimeType = normalizeAttachmentMimeType(mimeType, fileName)
      const ticket = await cloudApi.createWorkspaceAttachmentUploadTicket(workspaceId, {
        cardId,
        fileName,
        mimeType: normalizedMimeType,
        sizeBytes: decodeBase64ToUint8Array(base64).byteLength,
      })
      const bytes = decodeBase64ToUint8Array(base64)
      const uploadResponse = await fetch(ticket.uploadUrl, {
        method: ticket.method || 'PUT',
        headers: {
          ...(ticket.headers || {}),
          ...((ticket.headers || {})['Content-Type']
            ? {}
            : { 'Content-Type': normalizedMimeType }),
        },
        body: bytes,
      })
      if (!uploadResponse.ok) {
        throw new Error(`上传附件失败: ${uploadResponse.status}`)
      }
      const sha256 = await computeSha256Hex(bytes)
      const commitResponse = await fetch(ticket.commitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sha256 }),
      })
      const commitPayload = await commitResponse.json().catch(() => null)
      if (!commitResponse.ok) {
        throw new Error(`提交附件元数据失败: ${commitResponse.status}`)
      }
      const committedAttachment = extractCommittedAttachment(commitPayload)
      if (!committedAttachment) {
        throw new Error('附件上传成功，但未返回附件信息')
      }
      await refreshSnapshot()
      return `_attach/${committedAttachment.fileName}`
    },

    async downloadAttachment() {
      unsupported('Web 版暂不支持通过 URL 直接导入附件')
    },

    async readAttachmentDataUrl(cardRef: string, attachmentRef: string) {
      const snapshot = await getSnapshot()
      const record = resolveAttachmentRecord(snapshot, cardRef, attachmentRef)
      if (!record) {
        throw new Error(`未找到附件: ${attachmentRef}`)
      }
      const blob = await fetchAttachmentBlob(workspaceId, record.id)
      return blobToDataUrl(blob)
    },

    readConfig: async () => {
      const snapshot = await getSnapshot()
      return snapshot.config.configJson
    },

    writeConfig: async (content: unknown) => {
      await LocalDB.updateWorkspaceConfig({
        workspaceId,
        configJson:
          content && typeof content === 'object' && !Array.isArray(content)
            ? (content as Record<string, unknown>)
            : {},
      })
    },
  }
}

export type RemoteGraphStorage = {
  readLayout: (roomRef: string) => Promise<GraphMeta>
}

