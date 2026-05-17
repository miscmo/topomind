import styles from './HomePage.module.css'

interface CreateKBDialogProps {
  visible: boolean
  name: string
  loading: boolean
  error: string
  onNameChange: (name: string) => void
  onErrorClear: () => void
  onClose: () => void
  onSubmit: () => void
}

export function CreateKBDialog(props: CreateKBDialogProps) {
  const { visible, name, loading, error, onNameChange, onErrorClear, onClose, onSubmit } = props

  return (
    <div
      inert={!visible ? "" : undefined}
      className={`${styles.formOverlay} ${visible ? styles.active : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={styles.form}>
        <div className={styles.formHeader}>
          <h3>新建知识库</h3>
          <button className={styles.formClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.formBody}>
          <div className={styles.formGroup}>
            <label htmlFor="kb-name">知识库名称</label>
            <input
              id="kb-name"
              type="text"
              value={name}
              onChange={(e) => { onNameChange(e.target.value); onErrorClear() }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !loading) onSubmit() }}
              placeholder="输入知识库名称"
              autoFocus
            />
            {error && <div className={styles.formError}>{error}</div>}
          </div>
        </div>
        <div className={styles.formFooter}>
          <button className={styles.btnCancel} onClick={onClose} disabled={loading}>取消</button>
          <button className={styles.btnPrimary} onClick={onSubmit} disabled={loading}>
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
