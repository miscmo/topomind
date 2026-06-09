import { cloudApi, getCloudSessionSnapshot } from './cloud-api'
import { refreshAccessToken } from './http-client'

const attachmentObjectUrlCache = new Map<string, string>()

function buildCacheKey(input: {
  workspaceId: string
  attachmentId: string
  fileName: string
}) {
  return `${input.workspaceId}:${input.attachmentId}:${input.fileName}`
}

async function fetchAttachmentBlob(input: {
  workspaceId: string
  attachmentId: string
  fileName: string
}) {
  const session = getCloudSessionSnapshot()
  let accessToken = session.accessToken
  if (!accessToken) {
    if (!session.refreshToken) {
      throw new Error('当前没有可用的云端访问令牌')
    }
    accessToken = await refreshAccessToken(session.refreshToken)
  }

  const request = async (token: string) => fetch(
    `${cloudApi.getBaseUrl()}/workspaces/${input.workspaceId}/attachments/${input.attachmentId}/content`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  )

  let response = await request(accessToken)
  if (response.status === 401) {
    const latestSession = getCloudSessionSnapshot()
    if (!latestSession.refreshToken) {
      throw new Error('当前没有可用的云端访问令牌')
    }
    accessToken = await refreshAccessToken(latestSession.refreshToken)
    response = await request(accessToken)
  }
  if (!response.ok) {
    throw new Error(`读取附件失败: ${response.status}`)
  }
  return response.blob()
}

export async function getCloudAttachmentLocalUrl(input: {
  workspaceId: string
  attachmentId: string
  fileName: string
}): Promise<string | null> {
  const cacheKey = buildCacheKey(input)
  const cached = attachmentObjectUrlCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const blob = await fetchAttachmentBlob(input)
  const objectUrl = URL.createObjectURL(blob)
  attachmentObjectUrlCache.set(cacheKey, objectUrl)
  return objectUrl
}

export async function openCloudAttachment(input: {
  workspaceId: string
  attachmentId: string
  fileName: string
}): Promise<boolean> {
  const url = await getCloudAttachmentLocalUrl(input)
  if (!url) {
    return false
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

export async function showCloudAttachmentInFolder(input: {
  workspaceId: string
  attachmentId: string
  fileName: string
}): Promise<boolean> {
  return openCloudAttachment(input)
}
