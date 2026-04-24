/**
 * ConfirmModal — replaces window.confirm() in Electron renderer.
 * Mount once in App.tsx.
 */
import { useCallback, memo } from 'react'
import { useConfirmStore } from '../../stores/confirmStore'
import styles from './ConfirmModal.module.css'

export const ConfirmModal = memo(function ConfirmModal() {
  const visible = useConfirmStore((s) => s.visible)
  const title = useConfirmStore((s) => s.title)
  const message = useConfirmStore((s) => s.message)
  const confirm = useConfirmStore((s) => s.confirm)
  const cancel = useConfirmStore((s) => s.cancel)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancel()
      }
    },
    [cancel]
  )

  if (!visible) return null

  return (
    <div className={styles.overlay} data-testid="confirm-modal" onClick={cancel}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className={styles.title} id="confirm-title">{title}</div>
        {message && <div className={styles.message}>{message}</div>}
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={cancel}>
            取消
          </button>
          <button className={styles.confirmBtn} onClick={confirm} autoFocus>
            确定
          </button>
        </div>
      </div>
    </div>
  )
})

export default ConfirmModal
