import styles from './HomePage.module.css'

interface ImportKBDialogProps {
  visible: boolean
  dir: string
  loading: boolean
  error: string
  onClose: () => void
  onSelectDir: () => void
  onSubmit: () => void
}

export function ImportKBDialog(props: ImportKBDialogProps) {
  const { visible, dir, loading, error, onClose, onSelectDir, onSubmit } = props

  return (
    <div
      className={`${styles.formOverlay} ${visible ? styles.active : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={styles.form}>
        <div className={styles.formHeader}>
          <h3>导入知识库</h3>
          <button className={styles.formClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.formBody}>
          <div className={styles.formGroup}>
            <label>选择文件夹</label>
            <div className={styles.importInputRow}>
              <input
                type="text"
                value={dir}
                readOnly
                placeholder="点击「选择文件夹」按钮选择"
                className={styles.importInputField}
              />
              <button
                className={styles.selectFolderBtn}
                onClick={onSelectDir}
              >
                选择文件夹
              </button>
            </div>
            {error && <div className={styles.formError}>{error}</div>}
          </div>
        </div>
        <div className={styles.formFooter}>
          <button className={styles.btnCancel} onClick={onClose} disabled={loading}>取消</button>
          <button className={styles.btnPrimary} onClick={onSubmit} disabled={loading || !dir}>
            {loading ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
