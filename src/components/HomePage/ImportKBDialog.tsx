
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
      inert={!visible ? "" : undefined}
      className={`fixed inset-0 bg-black/40 z-[10000] flex items-center justify-center opacity-0 invisible transition-all duration-250 backdrop-blur-[2px] ${visible ? '!opacity-100 !visible [&>div]:!scale-100 [&>div]:!translate-y-0 [&>div]:!opacity-100' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-[440px] max-w-[90%] overflow-hidden scale-95 translate-y-2.5 opacity-0 transition-all duration-300 shadow-[var(--shadow-lg)]">
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>导入知识库</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-150 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-200 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>选择文件夹</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dir}
                readOnly
                placeholder="点击「选择文件夹」按钮选择"
                className="flex-1 w-full p-[10px_14px] border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[13px] transition-all duration-200 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)] placeholder:text-[var(--color-text-muted)]"
              />
              <button
                className="whitespace-nowrap p-[10px_14px] text-[13px] bg-[var(--color-accent)] text-[var(--color-text-inverse)] rounded-lg border-none cursor-pointer hover:bg-[var(--color-accent-hover)]"
                onClick={onSelectDir}
              >
                选择文件夹
              </button>
            </div>
            {error && <div className="text-[var(--color-danger)] text-[12px] mt-1.5">{error}</div>}
          </div>
        </div>
        <div className="p-[14px_24px] bg-[var(--color-bg)] border-t border-[var(--color-border-light)] flex justify-end gap-2.5">
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-medium cursor-pointer transition-all duration-150 bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>取消</button>
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-semibold cursor-pointer transition-all duration-150 bg-[var(--color-primary)] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] hover:shadow-[var(--shadow-md)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onSubmit} disabled={loading || !dir}>
            {loading ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
