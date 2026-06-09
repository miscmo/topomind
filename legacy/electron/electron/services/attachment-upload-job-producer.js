import nodeFs from 'fs';
import nodePath from 'path';

export function normalizeAttachmentUploadSyncContext(syncContext) {
  if (!syncContext || typeof syncContext !== 'object' || Array.isArray(syncContext)) {
    return null;
  }

  const workspaceId =
    typeof syncContext.workspaceId === 'string' ? syncContext.workspaceId.trim() : '';
  const knowledgeBaseId =
    typeof syncContext.knowledgeBaseId === 'string' ? syncContext.knowledgeBaseId.trim() : '';
  const cardId = typeof syncContext.cardId === 'string' ? syncContext.cardId.trim() : '';
  const documentId =
    typeof syncContext.documentId === 'string' && syncContext.documentId.trim()
      ? syncContext.documentId.trim()
      : null;

  if (!workspaceId) {
    return null;
  }
  const scopeCount = (knowledgeBaseId ? 1 : 0) + (cardId ? 1 : 0);
  if (scopeCount !== 1) {
    return null;
  }
  if (!cardId && documentId) {
    return null;
  }

  return {
    workspaceId,
    knowledgeBaseId: knowledgeBaseId || null,
    cardId: cardId || null,
    documentId,
  };
}

function detectMimeTypeFromFileName(fileName) {
  const extension = nodePath.extname(String(fileName || '')).slice(1).toLowerCase();
  const mimeByExtension = {
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
  };
  return mimeByExtension[extension] || 'application/octet-stream';
}

export function createAttachmentUploadJobProducer(deps) {
  const {
    attachmentRefToPath,
    localDbService,
    writeLog = () => {},
  } = deps;

  function enqueueFromRef(rootDir, cardPath, attachmentRef, syncContext, source, uploadTicketJson) {
    const normalizedContext = normalizeAttachmentUploadSyncContext(syncContext);
    if (!normalizedContext) {
      return null;
    }

    try {
      const localFilePath = attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(localFilePath)) {
        return null;
      }

      const fileStat = nodeFs.statSync(localFilePath);
      if (!fileStat.isFile()) {
        return null;
      }

      return localDbService.createAttachmentUploadJob({
        workspaceId: normalizedContext.workspaceId,
        localFilePath,
        knowledgeBaseId: normalizedContext.knowledgeBaseId,
        cardId: normalizedContext.cardId,
        documentId: normalizedContext.documentId,
        fileName: nodePath.basename(localFilePath),
        mimeType: detectMimeTypeFromFileName(localFilePath),
        sizeBytes: fileStat.size,
        uploadTicketJson: {
          ...(isPlainObject(uploadTicketJson) ? uploadTicketJson : {}),
          source,
          attachmentRef,
          mode: 'local_attachment_pending_upload',
        },
        storageKey: null,
        sha256: null,
      });
    } catch (error) {
      writeLog({
        level: 'ERROR',
        module: 'AttachmentUploadJobProducer',
        action: 'attachment:enqueueUploadJob',
        message: '附件上传任务建单失败',
        params: {
          cardPath,
          attachmentRef,
          workspaceId: normalizedContext.workspaceId,
          knowledgeBaseId: normalizedContext.knowledgeBaseId,
          cardId: normalizedContext.cardId,
          documentId: normalizedContext.documentId,
          source,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  return {
    enqueueFromRef,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
