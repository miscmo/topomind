import { logger } from './logger'
import {
  CloudApiError,
  buildApiError,
  getBaseUrl,
  parseApiResponse,
  refreshAccessToken,
  requestJson,
} from './http-client'
import type { CloudUserSummary, CloudSessionState } from '../stores/cloudSessionStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import type {
  CloudBootstrapKnowledgeBase,
  CloudBootstrapCard,
  CloudBootstrapAttachment,
  CloudBootstrapConfig,
  CloudBootstrapGraphLayout,
  CloudSyncPullEvent,
  CloudSyncPullData,
  CloudSyncPushRequest,
  CloudSyncPushSuccessData,
  CloudWorkspaceBootstrap,
} from '../types/local-sync'

interface CloudSessionPayload {
  accessToken: string
  refreshToken: string
  user: CloudUserSummary
}

export type CloudAttachmentUploadTicketRequest =
  | {
      cardId: string
      knowledgeBaseId?: never
      documentId?: string | null
      fileName: string
      mimeType: string
      sizeBytes: number
    }
  | {
      knowledgeBaseId: string
      cardId?: never
      documentId?: never
      fileName: string
      mimeType: string
      sizeBytes: number
    }

export interface CloudAttachmentUploadTicket extends Record<string, unknown> {
  uploadUrl: string
  method: string
  headers: Record<string, string>
  storageKey: string
  expiresAt: string
  maxSizeBytes: number
  allowedMimeTypes: string[]
  commitUrl: string
  commitToken: string
}

export interface CloudAttachmentDeleteResponse {
  attachment: CloudBootstrapAttachment
  event: CloudSyncPullEvent
}

export interface CloudWorkspaceConfigUpdateResponse {
  config: CloudBootstrapConfig
  event: CloudSyncPullEvent
}

export interface CloudImportJob {
  id: string
  workspaceId: string
  createdBy: string | null
  sourceFileName: string
  sourceObjectKey: string | null
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  stage: 'source-import' | 'scan' | 'import-structure' | 'push' | 'import-attachments' | 'report'
  summaryJson: Record<string, unknown>
  reportJson: Record<string, unknown>
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export { CloudApiError }

async function requestMultipart<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const session = useCloudSessionStore.getState()
  let accessToken = session.accessToken
  if (!accessToken) {
    throw new Error('当前没有可用的云端访问令牌')
  }

  const send = async (token: string) => {
    try {
      return await fetch(`${getBaseUrl()}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
        body: formData,
      })
    } catch {
      throw new Error(`无法连接云端服务，请确认服务端已启动并可访问：${getBaseUrl()}`)
    }
  }

  let response = await send(accessToken)
  if (response.status === 401 && session.refreshToken) {
    accessToken = await refreshAccessToken(session.refreshToken)
    response = await send(accessToken)
  }

  const payload = await parseApiResponse<T>(response)
  if (!response.ok || !payload?.ok) {
    throw buildApiError(response, payload, `请求 ${path} 失败`)
  }
  return payload.data
}

export const cloudApi = {
  getBaseUrl,
  async register(input: {
    email: string
    password: string
    displayName?: string
  }) {
    const data = await requestJson<CloudSessionPayload>('/auth/register', {
      method: 'POST',
      body: input,
      requiresAuth: false,
      retryOnUnauthorized: false,
    })
    useCloudSessionStore.getState().setSession(data)
    return data
  },
  async login(input: {
    email: string
    password: string
  }) {
    const data = await requestJson<CloudSessionPayload>('/auth/login', {
      method: 'POST',
      body: input,
      requiresAuth: false,
      retryOnUnauthorized: false,
    })
    useCloudSessionStore.getState().setSession(data)
    return data
  },
  async refresh() {
    const refreshToken = useCloudSessionStore.getState().refreshToken
    if (!refreshToken) {
      throw new Error('当前没有可用的 refresh token')
    }
    const accessToken = await refreshAccessToken(refreshToken)
    logger.info('CloudAPI', '云端会话刷新成功')
    return accessToken
  },
  async getWorkspaces() {
    return requestJson<{ items: Array<{ id: string; name: string; role: string; updatedAt: string }> }>(
      '/workspaces',
    )
  },
  async getWorkspaceBootstrap(workspaceId: string) {
    return requestJson<CloudWorkspaceBootstrap>(`/workspaces/${workspaceId}/bootstrap`)
  },
  async createWorkspaceKnowledgeBase(
    workspaceId: string,
    input: {
      name: string
      sortOrder?: number
    },
  ) {
    return requestJson<CloudBootstrapKnowledgeBase>(
      `/workspaces/${workspaceId}/knowledge-bases`,
      {
        method: 'POST',
        body: input,
      },
    )
  },
  async updateWorkspaceKnowledgeBase(
    workspaceId: string,
    kbId: string,
    input: {
      name?: string
      sortOrder?: number
      coverAttachmentId?: string | null
    },
  ) {
    return requestJson<CloudBootstrapKnowledgeBase>(
      `/workspaces/${workspaceId}/knowledge-bases/${kbId}`,
      {
        method: 'PATCH',
        body: input,
      },
    )
  },
  async deleteWorkspaceKnowledgeBase(workspaceId: string, kbId: string) {
    return requestJson<CloudBootstrapKnowledgeBase>(
      `/workspaces/${workspaceId}/knowledge-bases/${kbId}`,
      {
        method: 'DELETE',
      },
    )
  },
  async restoreWorkspaceKnowledgeBase(workspaceId: string, kbId: string) {
    return requestJson<CloudBootstrapKnowledgeBase>(
      `/workspaces/${workspaceId}/knowledge-bases/${kbId}/restore`,
      {
        method: 'POST',
      },
    )
  },
  async purgeWorkspaceKnowledgeBase(workspaceId: string, kbId: string) {
    return requestJson<CloudBootstrapKnowledgeBase>(
      `/workspaces/${workspaceId}/knowledge-bases/${kbId}/purge`,
      {
        method: 'DELETE',
      },
    )
  },
  async createWorkspaceCard(
    workspaceId: string,
    input: {
      kbId: string
      parentId?: string | null
      name: string
      sortOrder?: number
      status?: string
      metaJson?: Record<string, unknown>
    },
  ) {
    return requestJson<CloudBootstrapCard>(
      `/workspaces/${workspaceId}/cards`,
      {
        method: 'POST',
        body: input,
      },
    )
  },
  async updateWorkspaceCard(
    workspaceId: string,
    cardId: string,
    input: {
      name?: string
      sortOrder?: number
      status?: string
      metaJson?: Record<string, unknown>
    },
  ) {
    return requestJson<CloudBootstrapCard>(
      `/workspaces/${workspaceId}/cards/${cardId}`,
      {
        method: 'PATCH',
        body: input,
      },
    )
  },
  async deleteWorkspaceCard(workspaceId: string, cardId: string) {
    return requestJson<CloudBootstrapCard>(
      `/workspaces/${workspaceId}/cards/${cardId}`,
      {
        method: 'DELETE',
      },
    )
  },
  async restoreWorkspaceCard(workspaceId: string, cardId: string) {
    return requestJson<CloudBootstrapCard>(
      `/workspaces/${workspaceId}/cards/${cardId}/restore`,
      {
        method: 'POST',
      },
    )
  },
  async purgeWorkspaceCard(workspaceId: string, cardId: string) {
    return requestJson<CloudBootstrapCard>(
      `/workspaces/${workspaceId}/cards/${cardId}/purge`,
      {
        method: 'DELETE',
      },
    )
  },
  async getWorkspaceGraphLayout(workspaceId: string, layoutId: string) {
    return requestJson<CloudBootstrapGraphLayout>(
      `/workspaces/${workspaceId}/graph-layouts/${layoutId}`,
    )
  },
  async saveWorkspaceGraphLayout(
    workspaceId: string,
    layoutId: string,
    input: {
      kbId: string
      roomCardId?: string | null
      baseVersion: number
      layoutJson: Record<string, unknown>
      viewportJson: Record<string, unknown>
    },
  ) {
    return requestJson<CloudBootstrapGraphLayout>(
      `/workspaces/${workspaceId}/graph-layouts/${layoutId}`,
      {
        method: 'PATCH',
        body: input,
      },
    )
  },
  async patchWorkspaceGraphLayout(
    workspaceId: string,
    layoutId: string,
    input: {
      kbId: string
      roomCardId?: string | null
      baseVersion: number
      nodePatches?: Record<string, unknown>
      viewport?: Record<string, unknown>
    },
  ) {
    return requestJson<CloudBootstrapGraphLayout>(
      `/workspaces/${workspaceId}/graph-layouts/${layoutId}/patch`,
      {
        method: 'POST',
        body: input,
      },
    )
  },
  async createWorkspaceAttachmentUploadTicket(
    workspaceId: string,
    input: CloudAttachmentUploadTicketRequest,
  ) {
    return requestJson<CloudAttachmentUploadTicket>(
      `/workspaces/${workspaceId}/attachments/upload-ticket`,
      {
        method: 'POST',
        body: input,
      },
    )
  },
  async deleteWorkspaceAttachment(workspaceId: string, attachmentId: string) {
    return requestJson<CloudAttachmentDeleteResponse>(
      `/workspaces/${workspaceId}/attachments/${attachmentId}`,
      {
        method: 'DELETE',
      },
    )
  },
  async restoreWorkspaceAttachment(workspaceId: string, attachmentId: string) {
    return requestJson<CloudAttachmentDeleteResponse>(
      `/workspaces/${workspaceId}/attachments/${attachmentId}/restore`,
      {
        method: 'POST',
      },
    )
  },
  async purgeWorkspaceAttachment(workspaceId: string, attachmentId: string) {
    return requestJson<CloudAttachmentDeleteResponse>(
      `/workspaces/${workspaceId}/attachments/${attachmentId}/purge`,
      {
        method: 'DELETE',
      },
    )
  },
  async updateWorkspaceConfig(
    workspaceId: string,
    input: {
      baseVersion: number
      configJson: Record<string, unknown>
    },
  ) {
    return requestJson<CloudWorkspaceConfigUpdateResponse>(
      `/workspaces/${workspaceId}/config`,
      {
        method: 'PUT',
        body: input,
      },
    )
  },
  async createWorkspaceImport(workspaceId: string, file: File) {
    const formData = new FormData()
    formData.set('file', file, file.name)
    return requestMultipart<CloudImportJob>(`/workspaces/${workspaceId}/imports`, formData)
  },
  async getWorkspaceImportJob(workspaceId: string, importJobId: string) {
    return requestJson<CloudImportJob>(`/workspaces/${workspaceId}/imports/${importJobId}`)
  },
  async getWorkspaceImportReport(workspaceId: string, importJobId: string) {
    return requestJson<{
      importJobId: string
      status: CloudImportJob['status']
      stage: CloudImportJob['stage']
      reportJson: Record<string, unknown>
    }>(`/workspaces/${workspaceId}/imports/${importJobId}/report`)
  },
  async getWorkspaceSyncPull(
    workspaceId: string,
    options: {
      afterEventId?: number
      limit?: number
    } = {},
  ) {
    const search = new URLSearchParams()
    if (typeof options.afterEventId === 'number' && Number.isFinite(options.afterEventId)) {
      search.set('afterEventId', String(options.afterEventId))
    }
    if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
      search.set('limit', String(options.limit))
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return requestJson<CloudSyncPullData>(`/workspaces/${workspaceId}/sync/pull${suffix}`)
  },
  async postWorkspaceSyncPush(workspaceId: string, input: CloudSyncPushRequest) {
    return requestJson<CloudSyncPushSuccessData>(`/workspaces/${workspaceId}/sync/push`, {
      method: 'POST',
      body: input,
    })
  },
}

export function getCloudSessionSnapshot(): Pick<
  CloudSessionState,
  'accessToken' | 'refreshToken' | 'user'
> {
  const state = useCloudSessionStore.getState()
  return {
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    user: state.user,
  }
}
