/**
 * ConfirmModal — replaces window.confirm() in Electron renderer.
 * Mount once in App.tsx.
 */
import { memo } from 'react'
import { useConfirmStore } from '../../stores/confirmStore'
import { Button } from '../ui/button'

export const ConfirmModal = memo(function ConfirmModal() {
  const visible = useConfirmStore((s) => s.visible)
  const title = useConfirmStore((s) => s.title)
  const message = useConfirmStore((s) => s.message)
  const confirm = useConfirmStore((s) => s.confirm)
  const cancel = useConfirmStore((s) => s.cancel)

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" onClick={cancel}>
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-xl border bg-surface p-6 shadow-popover animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="text-base font-semibold text-foreground" id="confirm-title">{title}</div>
        {message && <div className="rounded-md border border-border-subtle bg-muted px-3.5 py-3 text-sm leading-relaxed text-secondary-foreground">{message}</div>}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={cancel}>
            取消
          </Button>
          <Button variant="destructive" onClick={confirm} autoFocus>
            确定
          </Button>
        </div>
      </div>
    </div>
  )
})

export default ConfirmModal
