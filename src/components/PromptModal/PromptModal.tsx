/**
 * PromptModal — replaces window.prompt() in Electron renderer.
 * Reads state from usePromptStore. Mount once in App.tsx.
 */
import { useEffect, useState, useCallback, memo } from 'react'
import { usePromptStore } from '../../stores/promptStore'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../ui/modal'

export const PromptModal = memo(function PromptModal() {
  const visible = usePromptStore((s) => s.visible)
  const title = usePromptStore((s) => s.title)
  const placeholder = usePromptStore((s) => s.placeholder)
  const defaultValue = usePromptStore((s) => s.defaultValue)
  const close = usePromptStore((s) => s.close)

  const [value, setValue] = useState('')

  // Sync local value when defaultValue changes
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue, visible])

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
      }
      if (e.key === 'Escape') {
        handleCancel()
      }
    },
    [handleConfirm, handleCancel]
  )

  if (!visible) return null

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[9999]`} onClick={handleCancel}>
      <div className={`flex w-full max-w-[480px] flex-col gap-4 rounded-xl border bg-surface p-6 shadow-popover ${modalPanelEnterClassName}`} onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-foreground">{title}</div>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
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
