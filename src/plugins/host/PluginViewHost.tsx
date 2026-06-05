import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { getPluginManager } from '../bootstrap'
import type { PluginState } from './pluginTypes'

interface PluginViewHostProps {
  viewId: string
  fallbackRender?: () => ReactNode
}

interface PluginViewState {
  status: 'loading' | 'ready' | 'error'
  pluginId?: string
  pluginState?: PluginState
  errorMessage?: string
  lastErrorMessage?: string
  lastFailedAt?: string
  renderer?: (props: { viewId: string; pluginId: string }) => ReactNode
}

function formatFailedAt(value?: string): string | undefined {
  if (!value) {
    return undefined
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

export function PluginViewHost({ viewId, fallbackRender }: PluginViewHostProps) {
  const manager = useMemo(() => getPluginManager(), [])
  const registry = manager.getRegistry()
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<PluginViewState>(() => {
    const staticRecord = registry.getStaticView(viewId)
    const runtimeRenderer = registry.getViewRenderer(viewId)
    const diagnostics = staticRecord ? manager.getPluginDiagnostics(staticRecord.pluginId) : undefined

    if (runtimeRenderer && staticRecord) {
      return {
        status: 'ready',
        pluginId: staticRecord.pluginId,
        pluginState: diagnostics?.state,
        renderer: runtimeRenderer,
      }
    }

    if (!staticRecord && fallbackRender) {
      return {
        status: 'ready',
        pluginId: 'host.legacy',
      }
    }

    return {
      status: staticRecord ? 'loading' : 'error',
      pluginId: staticRecord?.pluginId,
      pluginState: diagnostics?.state,
      lastErrorMessage: diagnostics?.lastErrorMessage,
      lastFailedAt: diagnostics?.lastFailedAt,
      errorMessage: staticRecord ? undefined : `Unknown secondary view: ${viewId}`,
    }
  })

  const retryActivation = useCallback(() => {
    setRetryNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let disposed = false
    const staticRecord = registry.getStaticView(viewId)
    const runtimeRenderer = registry.getViewRenderer(viewId)
    const diagnostics = staticRecord ? manager.getPluginDiagnostics(staticRecord.pluginId) : undefined

    if (!staticRecord) {
      if (fallbackRender) {
        setState({
          status: 'ready',
          pluginId: 'host.legacy',
        })
      } else {
        setState({
          status: 'error',
          errorMessage: `Unknown secondary view: ${viewId}`,
        })
      }
      return () => {
        disposed = true
      }
    }

    if (runtimeRenderer) {
      setState({
        status: 'ready',
        pluginId: staticRecord.pluginId,
        pluginState: diagnostics?.state,
        renderer: runtimeRenderer,
      })
      return () => {
        disposed = true
      }
    }

    setState({
      status: 'loading',
      pluginId: staticRecord.pluginId,
      pluginState: diagnostics?.state,
      lastErrorMessage: diagnostics?.lastErrorMessage,
      lastFailedAt: diagnostics?.lastFailedAt,
    })

    void manager
      .ensureActivated(staticRecord.pluginId, { type: 'view', viewId })
      .then(() => {
        if (disposed) {
          return
        }

        const boundRenderer = registry.getViewRenderer(viewId)
        const pluginDiagnostics = manager.getPluginDiagnostics(staticRecord.pluginId)
        if (!boundRenderer) {
          setState({
            status: 'error',
            pluginId: staticRecord.pluginId,
            pluginState: pluginDiagnostics?.state,
            lastErrorMessage: pluginDiagnostics?.lastErrorMessage,
            lastFailedAt: pluginDiagnostics?.lastFailedAt,
            errorMessage: 'Plugin activated but no runtime renderer was registered for this view.',
          })
          return
        }

        setState({
          status: 'ready',
          pluginId: staticRecord.pluginId,
          pluginState: pluginDiagnostics?.state,
          renderer: boundRenderer,
        })
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        const pluginDiagnostics = manager.getPluginDiagnostics(staticRecord.pluginId)
        setState({
          status: 'error',
          pluginId: staticRecord.pluginId,
          pluginState: pluginDiagnostics?.state,
          lastErrorMessage: pluginDiagnostics?.lastErrorMessage,
          lastFailedAt: pluginDiagnostics?.lastFailedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      disposed = true
    }
  }, [fallbackRender, manager, registry, retryNonce, viewId])

  if (state.status === 'loading') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">
        正在加载页面...
      </div>
    )
  }

  if (state.status === 'error') {
    const failedAtLabel = formatFailedAt(state.lastFailedAt)
    const canRetry = state.pluginId && state.pluginId !== 'host.legacy' && state.pluginState !== 'disabled'

    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] px-6">
        <div className="max-w-[520px] text-center space-y-2">
          <div className="text-[15px] font-medium text-[var(--color-text-primary)]">页面加载失败</div>
          <div className="text-[13px]">viewId: {viewId}</div>
          {state.pluginId && <div className="text-[13px]">pluginId: {state.pluginId}</div>}
          {state.pluginState && <div className="text-[13px]">state: {state.pluginState}</div>}
          {state.errorMessage && <div className="text-[13px]">{state.errorMessage}</div>}
          {state.lastErrorMessage &&
            state.lastErrorMessage !== state.errorMessage && (
              <div className="text-[13px]">lastError: {state.lastErrorMessage}</div>
            )}
          {failedAtLabel && <div className="text-[13px]">lastFailedAt: {failedAtLabel}</div>}
          {canRetry && (
            <div className="pt-2">
              <button
                type="button"
                className="h-9 px-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]"
                onClick={retryActivation}
              >
                重试激活插件
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!state.renderer) {
    return <>{fallbackRender?.() ?? null}</>
  }

  return <>{state.renderer({ viewId, pluginId: state.pluginId ?? 'unknown-plugin' })}</>
}
