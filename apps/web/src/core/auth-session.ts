import { CloudApiError } from './cloud-api'
import { resetClientSession } from './session-reset'
import { useAuthUiStore, type AuthNoticeTone } from '../stores/authUiStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'

const CLOUD_WORKSPACE_STORAGE_KEY = 'topomind_cloud_workspace_id'

function clearStoredWorkspaceSelection() {
  try {
    localStorage.removeItem(CLOUD_WORKSPACE_STORAGE_KEY)
  } catch {
    // Ignore localStorage access failures in restricted environments.
  }
}

function isEnglishMessage(message: string) {
  return /^[\x00-\x7F\s.,:;!?'"()\-_/]+$/.test(message)
}

export function isUnauthorizedCloudApiError(error: unknown): error is CloudApiError {
  return error instanceof CloudApiError && error.status === 401
}

export function formatAuthErrorMessage(
  error: unknown,
  mode: 'login' | 'register' = 'login',
) {
  if (error instanceof CloudApiError) {
    const normalizedMessage = error.message.trim()

    if (error.code === 'ACCOUNT_ALREADY_EXISTS') {
      return '该邮箱已注册，请直接登录'
    }
    if (error.code === 'UNAUTHORIZED' && normalizedMessage === 'Account does not exist, please register first') {
      return '账号不存在，请先注册'
    }
    if (error.code === 'UNAUTHORIZED' && normalizedMessage === 'Invalid email or password') {
      return '邮箱或密码错误'
    }
    if (error.code === 'UNAUTHORIZED' && (
      normalizedMessage === 'User session is no longer valid'
      || normalizedMessage === 'Token is invalid or expired'
      || normalizedMessage === 'Token payload is invalid'
      || normalizedMessage === 'Missing bearer token'
    )) {
      return '登录状态已失效，请重新登录'
    }
    if (error.code === 'VALIDATION_ERROR' && normalizedMessage === 'Email is required') {
      return '请输入邮箱'
    }
    if (error.code === 'VALIDATION_ERROR' && normalizedMessage === 'Email format is invalid') {
      return '邮箱格式不正确'
    }
    if (error.code === 'VALIDATION_ERROR' && normalizedMessage === 'Password is required') {
      return '请输入密码'
    }
    if (error.code === 'VALIDATION_ERROR' && normalizedMessage === 'Password must contain at least 6 characters') {
      return '密码至少需要 6 位'
    }

    if (!isEnglishMessage(normalizedMessage)) {
      return normalizedMessage
    }
  }

  if (error instanceof Error && !isEnglishMessage(error.message)) {
    return error.message
  }

  return mode === 'register' ? '注册失败，请检查输入后重试' : '登录失败，请检查账号信息后重试'
}

export function logoutCloudSession(input: {
  noticeMessage?: string
  noticeTone?: AuthNoticeTone
} = {}) {
  const {
    noticeMessage = '已退出登录',
    noticeTone = 'success',
  } = input

  useCloudSessionStore.getState().clearSession()
  clearStoredWorkspaceSelection()
  resetClientSession()
  useAuthUiStore.getState().setAuthNotice({
    message: noticeMessage,
    tone: noticeTone,
  })
}

export function handleUnauthorizedCloudSession(
  error: unknown,
  noticeMessage = '登录状态已失效，请重新登录',
) {
  if (!isUnauthorizedCloudApiError(error)) {
    return false
  }

  logoutCloudSession({
    noticeMessage,
    noticeTone: 'warning',
  })
  return true
}
