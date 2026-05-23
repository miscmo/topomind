
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../ui/modal'

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

  if (!visible) return null

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`w-[440px] max-w-[90%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>新建知识库</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
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
            {error && <div className="text-[var(--color-danger)] text-[12px] mt-1.5">{error}</div>}
          </div>
        </div>
        <div className="p-[14px_24px] bg-[var(--color-bg)] border-t border-[var(--color-border-light)] flex justify-end gap-2.5">
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-medium cursor-pointer transition-all duration-75 bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>取消</button>
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-semibold cursor-pointer transition-all duration-75 bg-[var(--color-primary)] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] hover:shadow-[var(--shadow-md)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onSubmit} disabled={loading}>
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
