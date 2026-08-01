/**
 * ConfirmModal — replaces window.confirm() in Electron renderer.
 * Mount once in App.tsx.
 */
import { memo, useEffect, useRef, useCallback } from 'react'
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (visible) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // Delay focus to prevent Enter keydown/keyup race conditions
      // from instantly confirming the modal when it opens via Enter key
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus()
      }, 100)
      return () => {
        clearTimeout(timer)
        previousFocusRef.current?.focus()
      }
    }
  }, [visible])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [cancel])

  if (!visible) return null

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[99999]`} onClick={cancel} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
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
