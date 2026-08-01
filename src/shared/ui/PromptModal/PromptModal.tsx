/**
 * PromptModal — replaces window.prompt() in Electron renderer.
 * Reads state from usePromptStore. Mount once in App.tsx.
 */
import { useEffect, useState, useCallback, memo, useRef } from 'react'
import { usePromptStore } from './promptStore'
import { Button } from '../button'
import { Input } from '../input'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../modal'

export const PromptModal = memo(function PromptModal() {
  const visible = usePromptStore((s) => s.visible)
  const title = usePromptStore((s) => s.title)
  const placeholder = usePromptStore((s) => s.placeholder)
  const defaultValue = usePromptStore((s) => s.defaultValue)
  const close = usePromptStore((s) => s.close)

  const [value, setValue] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Sync local value when the prompt options change.
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue, visible])

  useEffect(() => {
    if (!visible) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      previousFocusRef.current?.focus()
    }
  }, [visible])

  const handleConfirm = useCallback(() => {
    close(value)
  }, [close, value])

  const handleCancel = useCallback(() => {
    close(null)
  }, [close])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [handleConfirm, handleCancel]
  )

  if (!visible) return null

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[9999]`} onClick={handleCancel} onKeyDown={handleKeyDown}>
      <div ref={dialogRef} className={`flex w-full max-w-[480px] flex-col gap-4 rounded-xl border bg-surface p-6 shadow-popover ${modalPanelEnterClassName}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <div className="text-base font-semibold text-foreground" id="prompt-title">{title}</div>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={title}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button variant="default" onClick={handleConfirm}>
            确定
          </Button>
        </div>
      </div>
    </div>
  )
})

export default PromptModal
