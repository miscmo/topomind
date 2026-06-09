import type { CloudUserSummary } from '../stores/cloudSessionStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'

interface SuccessResponse<T> {
  ok: true
  data: T
}

interface ErrorResponse {
  ok: false
  error?: {
    code?: string
    message?: string
    details?: Record<string, unknown>
  }
}

type ApiResponse<T> = SuccessResponse<T> | ErrorResponse

interface CloudSessionPayload {
  accessToken: string
  refreshToken: string
  user: CloudUserSummary
}

export interface HttpClientRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  accessToken?: string | null
  requiresAuth?: boolean
  retryOnUnauthorized?: boolean
}

export class CloudApiError extends Error {
  status: number
  code: string | null
  details: Record<string, unknown> | null

  constructor(input: {
    message: string
    status: number
    code?: string | null
    details?: Record<string, unknown> | null
  }) {
    super(input.message)
    this.name = 'CloudApiError'
    this.status = input.status
    this.code = input.code ?? null
    this.details = input.details ?? null
  }
}

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000'

export function getBaseUrl() {
  const configured = import.meta.env.VITE_TOPOMIND_SERVER_URL?.trim()
  return configured || DEFAULT_SERVER_URL
}

function buildNetworkUnavailableError() {
  return new Error(`无法连接云端服务，请确认服务端已启动并可访问：${getBaseUrl()}`)
}

export async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T> | null> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as ApiResponse<T>
  } catch {
    throw new Error(`服务端返回了不可解析的 JSON: ${response.status}`)
  }
}

function resolveErrorMessage(
  response: Response,
  payload: ApiResponse<unknown> | null,
  fallback: string,
) {
  if (payload && !payload.ok) {
    return payload.error?.message || payload.error?.code || fallback
  }
  return `${fallback} (${response.status})`
}

export function buildApiError(
  response: Response,
  payload: ApiResponse<unknown> | null,
  fallback: string,
) {
  const message = resolveErrorMessage(response, payload, fallback)
  const code = payload && !payload.ok ? payload.error?.code ?? null : null
  const details =
    payload && !payload.ok && payload.error?.details && typeof payload.error.details === 'object'
      ? payload.error.details
      : null
  return new CloudApiError({
    message,
    status: response.status,
    code,
    details,
  })
}

export async function refreshAccessToken(refreshToken: string) {
  let response: Response
  try {
    response = await fetch(`${getBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    })
  } catch (error) {
    // #region debug-point B:refresh-fetch-failed
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'electron-cloud-connect',
        runId: 'post-fix',
        hypothesisId: 'B',
        location: 'apps/web/src/core/http-client.ts:refreshAccessToken',
        msg: '[DEBUG] refreshAccessToken fetch failed',
        data: {
          baseUrl: getBaseUrl(),
          requestUrl: `${getBaseUrl()}/auth/refresh`,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          href: typeof window !== 'undefined' ? window.location.href : null,
          origin: typeof window !== 'undefined' ? window.location.origin : null,
          isDesktop: typeof window !== 'undefined' ? Boolean(window.electronAPI?.platform?.isDesktop) : false,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    throw buildNetworkUnavailableError()
  }

  const payload = await parseApiResponse<CloudSessionPayload>(response)
  if (!response.ok || !payload?.ok) {
    throw new Error(resolveErrorMessage(response, payload, '刷新云端会话失败'))
  }

  useCloudSessionStore.getState().setSession(payload.data)
  return payload.data.accessToken
}

export async function requestJson<T>(
  path: string,
  options: HttpClientRequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    accessToken,
    requiresAuth = true,
    retryOnUnauthorized = true,
  } = options
  const session = useCloudSessionStore.getState()
  const token = accessToken ?? session.accessToken

  if (requiresAuth && !token) {
    throw new Error('当前没有可用的云端访问令牌')
  }

  let response: Response
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // #region debug-point A:request-fetch-failed
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'electron-cloud-connect',
        runId: 'post-fix',
        hypothesisId: 'A',
        location: 'apps/web/src/core/http-client.ts:requestJson',
        msg: '[DEBUG] requestJson fetch failed',
        data: {
          baseUrl: getBaseUrl(),
          path,
          requestUrl: `${getBaseUrl()}${path}`,
          method,
          requiresAuth,
          hasAccessToken: Boolean(token),
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          href: typeof window !== 'undefined' ? window.location.href : null,
          origin: typeof window !== 'undefined' ? window.location.origin : null,
          isDesktop: typeof window !== 'undefined' ? Boolean(window.electronAPI?.platform?.isDesktop) : false,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    throw buildNetworkUnavailableError()
  }

  if (response.status === 401 && retryOnUnauthorized && session.refreshToken) {
    try {
      const refreshedAccessToken = await refreshAccessToken(session.refreshToken)
      return requestJson<T>(path, {
        ...options,
        accessToken: refreshedAccessToken,
        retryOnUnauthorized: false,
      })
    } catch (error) {
      useCloudSessionStore.getState().clearSession()
      throw error
    }
  }

  const payload = await parseApiResponse<T>(response)
  if (!response.ok || !payload?.ok) {
    throw buildApiError(response, payload, `请求 ${path} 失败`)
  }

  return payload.data
}
