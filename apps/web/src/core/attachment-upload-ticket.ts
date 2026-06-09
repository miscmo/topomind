import { cloudApi, type CloudAttachmentUploadTicket } from './cloud-api'
import type { AttachmentUploadSyncContext } from './storage/local-types'

type NormalizedAttachmentUploadSyncContext =
  | {
      workspaceId: string
      knowledgeBaseId: string
    }
  | {
      workspaceId: string
      cardId: string
      documentId: string | null
    }

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
}

export function inferMimeTypeFromFileName(fileName: string, fallback = 'application/octet-stream') {
  const extension = String(fileName || '').split('.').pop()?.trim().toLowerCase()
  if (!extension) {
    return fallback
  }
  return MIME_BY_EXTENSION[extension] || fallback
}

export function normalizeAttachmentMimeType(mimeType: string | null | undefined, fileName: string) {
  const normalized = typeof mimeType === 'string' ? mimeType.trim() : ''
  return normalized || inferMimeTypeFromFileName(fileName)
}

export async function maybeCreateAttachmentUploadTicket(input: {
  syncContext?: AttachmentUploadSyncContext
  fileName: string
  mimeType: string
  sizeBytes: number
}): Promise<CloudAttachmentUploadTicket | undefined> {
  const syncContext = normalizeSyncContext(input.syncContext)
  if (!syncContext) {
    return undefined
  }
  return cloudApi.createWorkspaceAttachmentUploadTicket(
    syncContext.workspaceId,
    'knowledgeBaseId' in syncContext
      ? {
          knowledgeBaseId: syncContext.knowledgeBaseId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        }
      : {
          cardId: syncContext.cardId,
          documentId: syncContext.documentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
  )
}

function normalizeSyncContext(
  syncContext: AttachmentUploadSyncContext | undefined,
): NormalizedAttachmentUploadSyncContext | null {
  if (!syncContext?.workspaceId) {
    return null
  }
  if ('knowledgeBaseId' in syncContext) {
    const knowledgeBaseId = syncContext.knowledgeBaseId
    if (typeof knowledgeBaseId !== 'string' || !knowledgeBaseId) {
      return null
    }
    return {
      workspaceId: syncContext.workspaceId,
      knowledgeBaseId,
    }
  }
  if (!syncContext.cardId) {
    return null
  }
  return {
    workspaceId: syncContext.workspaceId,
    cardId: syncContext.cardId,
    documentId: syncContext.documentId ?? null,
  }
}
