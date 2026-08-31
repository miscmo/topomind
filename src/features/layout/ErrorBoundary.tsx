import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../../shared/ui/button'
import { logWrite } from '../../core/log-backend'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 出错区域的名字，用于日志与降级文案定位，例如「知识库标签页」 */
  label?: string
  /**
   * 变化时会重置错误状态（例如切回该标签页、切换文档时自动恢复）。
   * 传入 [tabId] 之类的标识即可。
   */
  resetKeys?: Array<string | number | boolean | undefined | null>
  /** 自定义降级 UI；不传则使用默认兜底界面 */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 通用错误边界。
 *
 * 应用此前没有任何错误边界：任一组件抛错（历史上 BlockNote 子组件抛错就发生过）
 * 会直接把整棵 React 树卸载，表现为整页白屏、用户只能重启。
 * 这里按区域隔离故障，出错时只降级该区域，并提供重试入口。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 写进应用日志（系统日志面板可见），避免错误只存在于开发者工具里
    void logWrite({
      level: 'ERROR',
      module: 'ErrorBoundary',
      action: this.props.label ? `渲染异常: ${this.props.label}` : '渲染异常',
      params: {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
        componentStack: info?.componentStack ?? null,
      },
    })
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info)
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // resetKeys 变化时自动恢复，例如切换标签页/文档后不必手动点重试
    const prevKeys = prev.resetKeys ?? []
    const nextKeys = this.props.resetKeys ?? []
    if (this.state.error && (prevKeys.length !== nextKeys.length || prevKeys.some((k, i) => k !== nextKeys[i]))) {
      this.reset()
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { children, label, fallback } = this.props
    if (!error) return children
    if (fallback) return fallback(error, this.reset)
    return <ErrorFallback error={error} label={label} onReset={this.reset} />
  }
}

function ErrorFallback({
  error,
  label,
  onReset,
}: {
  error: Error
  label?: string
  onReset: () => void
}) {
  return (
    <div className="w-full h-full min-h-[200px] flex items-center justify-center p-6 bg-[var(--color-surface)] box-border">
      <div className="max-w-[420px] text-center">
        <div className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-2">
          {label ? `${label}加载失败` : '内容加载失败'}
        </div>
        <div className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] mb-4">
          该区域遇到了意外错误，已停止渲染以避免影响其他内容。你的数据已保存在本地，可以重试加载。
        </div>
        <pre className="max-h-[120px] overflow-auto text-left text-[11px] leading-relaxed text-[var(--color-text-muted)] bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)] rounded-md p-2.5 mb-4 whitespace-pre-wrap break-words">
          {error?.message ?? String(error)}
        </pre>
        <div className="flex items-center justify-center gap-2">
          <Button variant="default" size="sm" onClick={onReset}>
            重试
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            重启应用
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ErrorBoundary
