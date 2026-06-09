import type { AttachmentDebugHealthResponse } from '../types/debug-runtime'
import { getCloudSessionSnapshot } from './cloud-api'

export async function getAttachmentDebugHealth(): Promise<AttachmentDebugHealthResponse> {
  const session = getCloudSessionSnapshot()
  return {
    ready: false,
    stage: 'web-runtime',
    currentAttachmentJobId: null,
    processing: false,
    supportedChannels: [],
    lastError: '后端暂未提供调试数据',
    cloudSession: {
      hasAccessToken: Boolean(session.accessToken),
      hasRefreshToken: Boolean(session.refreshToken),
      userId: session.user?.id ?? null,
    },
  }
}
