import { useEffect } from 'react'
import { useToastStore, type ToastItem } from '@/stores/toastStore'

const LEVEL_STYLES: Record<ToastItem['level'], { bar: string; label: string }> = {
  info: { bar: 'bg-[var(--color-accent)]', label: 'text-[var(--color-text-secondary)]' },
  warn: { bar: 'bg-[var(--color-warning,#e0a800)]', label: 'text-[var(--color-warning,#e0a800)]' },
  error: { bar: 'bg-[var(--color-danger,#e5484d)]', label: 'text-[var(--color-danger,#e5484d)]' },
}

const LEVEL_LABEL: Record<ToastItem['level'], string> = {
  info: '提示',
  warn: '警告',
  error: '错误',
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismissToast)

  useEffect(() => {
    if (item.duration <= 0) return
    const timer = window.setTimeout(() => dismiss(item.id), item.duration)
    return () => window.clearTimeout(timer)
  }, [item.id, item.duration, dismiss])

  const style = LEVEL_STYLES[item.level]
  return (
    <div
      role="alert"
      className="pointer-events-auto flex w-[320px] max-w-[90vw] gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 shadow-lg"
    >
      <div className={`mt-0.5 h-full w-1 shrink-0 rounded-full ${style.bar}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-semibold ${style.label}`}>
          {LEVEL_LABEL[item.level]}：{item.title}
        </div>
        {item.message && (
          <div className="mt-1 break-words text-[12px] leading-snug text-[var(--color-text-secondary)]">
            {item.message}
          </div>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick()
              dismiss(item.id)
            }}
            className="mt-2 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-soft)]"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="shrink-0 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex flex-col gap-2">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
