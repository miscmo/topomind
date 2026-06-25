/**
 * ConfirmModal — replaces window.confirm() in Electron renderer.
 * Mount once in App.tsx.
 */
import { memo, useEffect, useRef } from 'react'
import { useConfirmStore } from './confirmStore'
import { Button } from '../button'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../modal'

export const ConfirmModal = memo(function ConfirmModal() {
  const visible = useConfirmStore((s) => s.visible)
  const title = useConfirmStore((s) => s.title)
  const message = useConfirmStore((s) => s.message)
  const confirmText = useConfirmStore((s) => s.confirmText)
  const cancelText = useConfirmStore((s) => s.cancelText)
  const extraButtonText = useConfirmStore((s) => s.extraButtonText)
  const onExtraAction = useConfirmStore((s) => s.onExtraAction)
  const confirm = useConfirmStore((s) => s.confirm)
  const cancel = useConfirmStore((s) => s.cancel)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (visible) {
      // Delay focus to prevent Enter keydown/keyup race conditions
      // from instantly confirming the modal when it opens via Enter key
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[99999]`} onClick={cancel}>
      <div
        className={`flex w-full max-w-[480px] flex-col gap-4 rounded-xl border bg-surface p-6 shadow-popover ${modalPanelEnterClassName}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="text-base font-semibold text-foreground" id="confirm-title">{title}</div>
        {message && <div className="rounded-md border border-border-subtle bg-muted px-3.5 py-3 text-sm leading-relaxed text-secondary-foreground">{message}</div>}
        <div className="mt-2 flex justify-end gap-2">
          {extraButtonText && onExtraAction && (
            <Button variant="secondary" onClick={() => { onExtraAction(); cancel(); }}>
              {extraButtonText}
            </Button>
          )}
          <Button variant="outline" onClick={cancel}>
            {cancelText || '取消'}
          </Button>
          <Button variant="destructive" onClick={confirm} ref={confirmButtonRef}>
            {confirmText || '确定'}
          </Button>
        </div>
      </div>
    </div>
  )
})

export default ConfirmModal
