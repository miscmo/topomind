
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../../../shared/ui/modal'

interface ImportKBDialogProps {
  visible: boolean
  fileName: string
  loading: boolean
  error: string
  onClose: () => void
  onSelectFile: (file: File | null) => void
  onSubmit: () => void
}

export function ImportKBDialog(props: ImportKBDialogProps) {
  const { visible, fileName, loading, error, onClose, onSelectFile, onSubmit } = props

  if (!visible) return null

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`w-[440px] max-w-[90%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>导入知识库</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          <div className="mb-4 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            当前会先上传一个旧工作区 ZIP 包，再创建后台导入任务，由 worker 串行执行；创建成功后可在监控页查看结构导入与附件导入进度。
          </div>
          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>选择 ZIP 文件</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={fileName}
                readOnly
                placeholder="请选择旧工作区 ZIP 文件"
                className="flex-1 w-full p-[10px_14px] border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[13px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)] placeholder:text-[var(--color-text-muted)]"
              />
              <label className="whitespace-nowrap p-[10px_14px] text-[13px] bg-[var(--color-accent)] text-[var(--color-text-inverse)] rounded-lg border-none cursor-pointer hover:bg-[var(--color-accent-hover)]">
                选择 ZIP
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            {error && <div className="text-[var(--color-danger)] text-[12px] mt-1.5">{error}</div>}
          </div>
        </div>
        <div className="p-[14px_24px] bg-[var(--color-bg)] border-t border-[var(--color-border-light)] flex justify-end gap-2.5">
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-medium cursor-pointer transition-all duration-75 bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>取消</button>
          <button className="p-[8px_20px] rounded-lg border-none text-[13px] font-semibold cursor-pointer transition-all duration-75 bg-[var(--color-primary)] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] hover:shadow-[var(--shadow-md)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onSubmit} disabled={loading || !fileName}>
            {loading ? '创建中...' : '创建导入任务'}
          </button>
        </div>
      </div>
    </div>
  )
}

