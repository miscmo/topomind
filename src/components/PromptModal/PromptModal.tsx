/**
 * PromptModal — replaces window.prompt() in Electron renderer.
 * Reads state from usePromptStore. Mount once in App.tsx.
 */
import { useEffect, useState, useCallback, memo } from 'react'
import { usePromptStore } from '../../stores/promptStore'
import styles from './PromptModal.module.css'

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
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{title}</div>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
        />
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={handleCancel}>
            取消
          </button>
          <button className={styles.confirmBtn} onClick={handleConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
})

export default PromptModal
