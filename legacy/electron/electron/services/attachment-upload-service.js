import nodeFs from 'fs';
import { createHash } from 'crypto';

export function createAttachmentUploadService(deps) {
  const {
    localDbService,
    writeLog,
    commitUploadedAttachment,
    issueUploadTicket,
    getCloudSessionHealth,
    onTerminalState = () => {},
  } = deps;

  if (!localDbService) {
    throw new Error('localDbService is required');
  }

  let processing = false;
  let activeStage = 'idle';
  let activeAttachmentJobId = null;
  let lastError = '';

  function log(level, action, message, params) {
    if (typeof writeLog === 'function') {
      writeLog({
        level,
        module: 'AttachmentUploadService',
        action,
        message,
        params,
      });
    }
  }

  function healthCheck() {
    return {
      ready: true,
      stage: processing ? activeStage : 'idle',
      supportedChannels: ['attachment:health'],
      currentAttachmentJobId: activeAttachmentJobId,
      processing,
      lastError,
      cloudSession:
        typeof getCloudSessionHealth === 'function'
          ? getCloudSessionHealth()
          : undefined,
    };
  }

  async function processPendingJobs() {
    if (processing) {
      return;
    }

    processing = true;
    lastError = '';

    try {
      while (true) {
        const job = localDbService.claimNextPendingAttachmentUploadJob();
        if (!job) {
          activeStage = 'idle';
          activeAttachmentJobId = null;
          return;
        }

        activeStage = 'uploading';
        activeAttachmentJobId = job.id;

        log('INFO', 'attachment:worker-start', '附件上传任务开始执行', {
          attachmentJobId: job.id,
          workspaceId: job.workspaceId,
          knowledgeBaseId: job.knowledgeBaseId,
          cardId: job.cardId,
          documentId: job.documentId,
          fileName: job.fileName,
          localFilePath: job.localFilePath,
        });

        try {
          assertLocalAttachmentFile(job.localFilePath);
          const sha256 = await computeSha256(job.localFilePath);
          const ticket = await ensureUploadTicket(job, normalizeUploadTicket(job.uploadTicketJson), issueUploadTicket);

          await uploadAttachmentFile(job.localFilePath, ticket, job.mimeType);

          localDbService.markAttachmentUploadJobUploaded({
            attachmentJobId: job.id,
            uploadTicketJson: ticket.raw,
            storageKey: ticket.storageKey,
            sha256,
          });

          activeStage = 'committing';
          localDbService.markAttachmentUploadJobCommitting({
            attachmentJobId: job.id,
            uploadTicketJson: ticket.raw,
            storageKey: ticket.storageKey,
            sha256,
          });

          if (typeof commitUploadedAttachment !== 'function') {
            throw buildWorkerError(
              'attachment_commit_not_supported',
              '云端附件 commit API 尚未接入，任务已完成上传前置校验但无法提交元数据',
            );
          }

          await Promise.resolve(
            commitUploadedAttachment({
              attachmentJobId: job.id,
              workspaceId: job.workspaceId,
              knowledgeBaseId: job.knowledgeBaseId,
              cardId: job.cardId,
              documentId: job.documentId,
              fileName: job.fileName,
              mimeType: job.mimeType,
              sizeBytes: job.sizeBytes,
              storageKey: ticket.storageKey,
              sha256,
              commitUrl: ticket.commitUrl,
              commitToken: ticket.commitToken,
              uploadTicketJson: ticket.raw,
            }),
          );

          const completedJob = localDbService.completeAttachmentUploadJob({
            attachmentJobId: job.id,
            uploadTicketJson: ticket.raw,
            storageKey: ticket.storageKey,
            sha256,
          });
          await Promise.resolve(onTerminalState(completedJob));

          log('INFO', 'attachment:worker-done', '附件上传任务已完成', {
            attachmentJobId: job.id,
            workspaceId: job.workspaceId,
            knowledgeBaseId: job.knowledgeBaseId,
            storageKey: ticket.storageKey,
          });
        } catch (error) {
          const code = getWorkerErrorCode(error);
          const message = error instanceof Error ? error.message : String(error);
          lastError = message;
          const failedJob = localDbService.failAttachmentUploadJob({
            attachmentJobId: job.id,
            lastErrorCode: code,
            lastErrorMessage: message,
          });
          await Promise.resolve(onTerminalState(failedJob));
          log('ERROR', 'attachment:worker-failed', '附件上传任务执行失败', {
            attachmentJobId: job.id,
            workspaceId: job.workspaceId,
            knowledgeBaseId: job.knowledgeBaseId,
            errorCode: code,
            error: message,
          });
        }
      }
    } finally {
      processing = false;
      if (!activeAttachmentJobId) {
        activeStage = 'idle';
      }
    }
  }

  return {
    healthCheck,
    processPendingJobs,
  };
}

function assertLocalAttachmentFile(localFilePath) {
  if (typeof localFilePath !== 'string' || !localFilePath.trim()) {
    throw buildWorkerError('attachment_local_file_invalid', '附件本地文件路径无效');
  }
  if (!nodeFs.existsSync(localFilePath)) {
    throw buildWorkerError('attachment_local_file_missing', `附件本地文件不存在: ${localFilePath}`);
  }
  const stat = nodeFs.statSync(localFilePath);
  if (!stat.isFile()) {
    throw buildWorkerError('attachment_local_file_invalid', `附件本地路径不是文件: ${localFilePath}`);
  }
}

async function computeSha256(localFilePath) {
  const buffer = await nodeFs.promises.readFile(localFilePath);
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeUploadTicket(input) {
  const raw = isPlainObject(input) ? { ...input } : {};
  const headers = isPlainObject(raw.headers)
    ? Object.fromEntries(
        Object.entries(raw.headers)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [String(key), String(value)]),
      )
    : {};

  return {
    raw: {
      ...raw,
      headers,
    },
    uploadUrl: normalizeNullableString(raw.uploadUrl),
    commitUrl: normalizeNullableString(raw.commitUrl),
    commitToken: normalizeNullableString(raw.commitToken),
    method: normalizeNullableString(raw.method)?.toUpperCase() || 'PUT',
    headers,
    storageKey: normalizeNullableString(raw.storageKey),
    expiresAt: normalizeNullableString(raw.expiresAt),
  };
}

async function ensureUploadTicket(job, ticket, issueUploadTicket) {
  if (isUsableUploadTicket(ticket)) {
    return ticket;
  }

  if (typeof issueUploadTicket !== 'function') {
    const errorCode = ticket.uploadUrl ? 'attachment_upload_ticket_expired' : 'attachment_upload_ticket_missing';
    throw buildWorkerError(
      errorCode,
      ticket.uploadUrl
        ? '附件 upload ticket 已过期，且主进程暂未接入续票能力'
        : '当前任务缺少 upload ticket，暂时无法上传到云端',
    );
  }

  const refreshedRaw = await Promise.resolve(
    issueUploadTicket({
      attachmentJobId: job.id,
      workspaceId: job.workspaceId,
      knowledgeBaseId: job.knowledgeBaseId,
      cardId: job.cardId,
      documentId: job.documentId,
      fileName: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
    }),
  );
  const refreshedTicket = normalizeUploadTicket({
    ...ticket.raw,
    ...(isPlainObject(refreshedRaw) ? refreshedRaw : {}),
    source:
      typeof ticket.raw?.source === 'string' && ticket.raw.source.trim() ? ticket.raw.source : refreshedRaw?.source,
    mode:
      typeof ticket.raw?.mode === 'string' && ticket.raw.mode.trim() ? ticket.raw.mode : refreshedRaw?.mode,
    importJobId:
      typeof ticket.raw?.importJobId === 'string' && ticket.raw.importJobId.trim()
        ? ticket.raw.importJobId
        : refreshedRaw?.importJobId,
    importedKbPath:
      typeof ticket.raw?.importedKbPath === 'string' && ticket.raw.importedKbPath.trim()
        ? ticket.raw.importedKbPath
        : refreshedRaw?.importedKbPath,
    relativePath:
      typeof ticket.raw?.relativePath === 'string' && ticket.raw.relativePath.trim()
        ? ticket.raw.relativePath
        : refreshedRaw?.relativePath,
    attachmentRef:
      typeof ticket.raw?.attachmentRef === 'string' && ticket.raw.attachmentRef.trim()
        ? ticket.raw.attachmentRef
        : refreshedRaw?.attachmentRef,
    ownerScope:
      typeof ticket.raw?.ownerScope === 'string' && ticket.raw.ownerScope.trim()
        ? ticket.raw.ownerScope
        : refreshedRaw?.ownerScope,
    ownerCardPath:
      typeof ticket.raw?.ownerCardPath === 'string' && ticket.raw.ownerCardPath.trim()
        ? ticket.raw.ownerCardPath
        : refreshedRaw?.ownerCardPath,
    headers: {
      ...(isPlainObject(ticket.raw?.headers) ? ticket.raw.headers : {}),
      ...(isPlainObject(refreshedRaw?.headers) ? refreshedRaw.headers : {}),
    },
  });
  if (!isUsableUploadTicket(refreshedTicket)) {
    throw buildWorkerError('attachment_upload_ticket_invalid', '主进程续签的附件 upload ticket 无效');
  }
  return refreshedTicket;
}

function isUsableUploadTicket(ticket) {
  if (!ticket.uploadUrl || !ticket.commitUrl || !ticket.storageKey) {
    return false;
  }
  if (!ticket.expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(ticket.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return expiresAtMs > Date.now() + 30 * 1000;
}

async function uploadAttachmentFile(localFilePath, ticket, mimeType) {
  if (ticket.expiresAt) {
    const expiresAtMs = Date.parse(ticket.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      throw buildWorkerError('attachment_upload_ticket_expired', '附件 upload ticket 已过期');
    }
  }

  const fileBuffer = await nodeFs.promises.readFile(localFilePath);
  const response = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: {
      ...(ticket.headers || {}),
      ...(ticket.headers?.['Content-Type'] ? {} : { 'Content-Type': mimeType || 'application/octet-stream' }),
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    throw buildWorkerError(
      'attachment_upload_request_failed',
      `附件上传失败: ${response.status}`,
    );
  }
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function buildWorkerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getWorkerErrorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string' && error.code.trim()) {
    return error.code.trim();
  }
  return 'attachment_upload_failed';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
