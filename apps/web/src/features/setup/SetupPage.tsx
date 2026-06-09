import { memo, useEffect, useState } from 'react'
import { cloudApi } from '../../core/cloud-api'
import { formatAuthErrorMessage, logoutCloudSession } from '../../core/auth-session'
import { Button } from '../../shared/ui/button'
import { Input } from '../../shared/ui/input'
import { useAuthUiStore } from '../../stores/authUiStore'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export default memo(function SetupPage() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const user = useCloudSessionStore((s) => s.user)
  const showWorkspace = useWorkspaceStore((s) => s.showWorkspace)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const availableWorkspaces = useWorkspaceStore((s) => s.availableWorkspaces)
  const workspaceSelectionLoading = useWorkspaceStore((s) => s.workspaceSelectionLoading)
  const workspaceSelectionError = useWorkspaceStore((s) => s.workspaceSelectionError)
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId)
  const noticeMessage = useAuthUiStore((s) => s.noticeMessage)
  const noticeTone = useAuthUiStore((s) => s.noticeTone)
  const clearAuthNotice = useAuthUiStore((s) => s.clearAuthNotice)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (accessToken && currentWorkspaceId) {
      clearAuthNotice()
      showWorkspace()
    }
  }, [accessToken, clearAuthNotice, currentWorkspaceId, showWorkspace])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim()
    const normalizedPassword = password.trim()
    const normalizedDisplayName = displayName.trim()

    if (!normalizedEmail || !normalizedPassword) {
      setErrorMessage('请输入邮箱和密码')
      return
    }

    setSubmitting(true)
    setErrorMessage('')
    clearAuthNotice()
    try {
      if (mode === 'register') {
        await cloudApi.register({
          email: normalizedEmail,
          password: normalizedPassword,
          displayName: normalizedDisplayName || undefined,
        })
      } else {
        await cloudApi.login({
          email: normalizedEmail,
          password: normalizedPassword,
        })
      }
    } catch (error) {
      const nextErrorMessage = formatAuthErrorMessage(error, mode)
      setErrorMessage(nextErrorMessage)
    } finally {
      setSubmitting(false)
    }
  }

  if (accessToken) {
    const hasWorkspaceOptions = availableWorkspaces.length > 0

    return (
      <div id="setup-page" className="absolute inset-0 w-full h-full min-h-0 bg-[var(--color-bg-app)] overflow-auto">
        <div className="min-h-full flex items-center justify-center p-4">
          <div className="w-full max-w-[560px] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-lg)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="m-0 text-[22px] font-semibold text-[var(--color-text-primary)]">选择工作区</h1>
                <p className="m-0 mt-1 text-[13px] text-[var(--color-text-muted)]">
                  {user?.displayName || user?.email || '当前账号'} 已登录，请选择要进入的云端工作区。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => logoutCloudSession({ noticeMessage: '已退出登录，请重新选择账号' })}
              >
                切换账号
              </Button>
            </div>

            {workspaceSelectionLoading ? (
              <div className="mt-5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
                正在加载可用工作区...
              </div>
            ) : null}

            {workspaceSelectionError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-300">
                {workspaceSelectionError}
              </div>
            ) : null}

            {!workspaceSelectionLoading && !workspaceSelectionError && !hasWorkspaceOptions ? (
              <div className="mt-5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
                当前账号还没有可用工作区，请联系管理员分配后再重试。
              </div>
            ) : null}

            {hasWorkspaceOptions ? (
              <div className="mt-5 flex flex-col gap-3">
                {availableWorkspaces.map((workspace) => {
                  const isSelected = workspace.id === currentWorkspaceId
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                        isSelected
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] hover:bg-[var(--color-bg-muted)]'
                      }`}
                      onClick={() => setCurrentWorkspaceId(workspace.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-medium text-[var(--color-text-primary)]">{workspace.name}</div>
                          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                            角色：{workspace.role}
                          </div>
                        </div>
                        <div className="text-[12px] text-[var(--color-text-muted)]">
                          {isSelected ? '正在进入...' : '进入工作区'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="mt-5 text-[12px] text-[var(--color-text-muted)]">
              单工作区账号会自动恢复；多工作区账号需要在这里显式选择。
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="setup-page" className="absolute inset-0 w-full h-full min-h-0 bg-[var(--color-bg-app)] overflow-auto">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="m-0 text-[22px] font-semibold text-[var(--color-text-primary)]">TopoMind</h1>
              <p className="m-0 mt-1 text-[13px] text-[var(--color-text-muted)]">
                {mode === 'login' ? '登录账号进入工作区' : '注册账号后立即开始使用'}
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[var(--color-bg-muted)] p-1">
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-muted)]'
              }`}
              onClick={() => {
                setMode('login')
                setErrorMessage('')
                clearAuthNotice()
              }}
              disabled={submitting}
            >
              登录
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                mode === 'register'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-muted)]'
              }`}
              onClick={() => {
                setMode('register')
                setErrorMessage('')
                clearAuthNotice()
              }}
              disabled={submitting}
            >
              注册
            </button>
          </div>
          <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          {noticeMessage ? (
            <div
              className={`rounded-lg border px-4 py-3 text-[13px] ${
                noticeTone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300'
                  : noticeTone === 'warning'
                    ? 'border-amber-500/20 bg-amber-500/8 text-amber-200'
                    : 'border-blue-500/20 bg-blue-500/8 text-blue-200'
              }`}
            >
              {noticeMessage}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text-primary)]" htmlFor="setup-email">
              邮箱
            </label>
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text-primary)]" htmlFor="setup-password">
              密码
            </label>
            <Input
              id="setup-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              disabled={submitting}
            />
          </div>
          {mode === 'register' ? (
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium text-[var(--color-text-primary)]" htmlFor="setup-display-name">
                显示名
              </label>
              <Input
                id="setup-display-name"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="不填则自动使用邮箱前缀"
                disabled={submitting}
              />
            </div>
          ) : null}
          <div className="text-[13px] text-[var(--color-text-muted)]">
            {submitting
              ? mode === 'login'
                ? '正在登录并恢复工作区...'
                : '正在注册账号并初始化工作区...'
              : mode === 'login'
                ? '请先登录已有账号。没有账号请切换到注册。'
                : '注册成功后将自动登录并进入默认工作区。'}
          </div>
          {errorMessage ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-300">
              {errorMessage}
            </div>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting
              ? mode === 'login'
                ? '登录中...'
                : '注册中...'
              : mode === 'login'
                ? '登录'
                : '注册并进入工作区'}
          </Button>
          </form>
        </div>
      </div>
    </div>
  )
})
