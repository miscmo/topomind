import { RotateCcw, Trash2, Book, FileText, Paperclip, AppWindow } from 'lucide-react'
import type { FSBTrashItem } from '../../../core/fs-backend'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../../../shared/ui/modal'
import { useTrashDialogModel } from './TrashDialog/model/useTrashDialogModel'

interface TrashDialogProps {
  visible: boolean
  onClose: () => void
  refreshKBList: () => Promise<void>
}

function formatDeletedAt(value: number) {
  if (!Number.isFinite(value)) return '未知时间'
  return new Date(value).toLocaleString('zh-CN')
}

function getItemIcon(item: FSBTrashItem) {
  if (item.category === 'kbs') {
    if (item.meta?.kind === 'card') return <AppWindow className="h-4 w-4 text-indigo-500" />
    return <Book className="h-4 w-4 text-[var(--color-primary)]" />
  }
  if (item.category === 'topo-documents') return <FileText className="h-4 w-4 text-sky-500" />
  if (item.category === 'attachments') return <Paperclip className="h-4 w-4 text-amber-500" />
  return <FileText className="h-4 w-4 text-gray-500" />
}

function getItemTypeName(item: FSBTrashItem) {
  if (item.category === 'kbs') {
    if (item.meta?.kind === 'card') return '节点'
    return '知识库'
  }
  if (item.category === 'topo-documents') return '文档'
  if (item.category === 'attachments') return '附件'
  return '未知'
}

export function TrashDialog({ visible, onClose, refreshKBList }: TrashDialogProps) {
  const { items, loading, error, handleRestore, handleClear } = useTrashDialogModel(visible, refreshKBList)

  if (!visible) return null

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`w-[560px] max-w-[92%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>全局回收站</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div className="mb-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</div>}
          <div className="mb-4 text-[13px] text-[var(--color-text-secondary)]">这里显示所有已删除的知识库、节点、文档和附件。清空操作不可恢复。恢复时如果原名称已存在，会自动添加后缀避免覆盖。</div>
          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[var(--color-border-light)]">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">加载中...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">回收站为空</div>
            ) : (
              items.map((item) => (
                <div key={item.trashName} className="flex items-center justify-between gap-4 border-b border-[var(--color-border-light)] p-3 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-bg-muted)]">
                      {getItemIcon(item)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-[var(--color-text-primary)]" title={item.businessName || item.originalName}>{item.businessName || item.originalName}</span>
                        <span className="flex-shrink-0 rounded bg-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">{getItemTypeName(item)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 truncate text-[12px] text-[var(--color-text-muted)]">
                        <span title={item.originalPath}>路径：{item.originalPath || item.trashName}</span>
                        <span>时间：{formatDeletedAt(item.deletedAt)}</span>
                        {item.isImage && item.previewUrl && (
                          <div className="group relative flex items-center">
                            <span className="cursor-pointer text-[var(--color-primary)] hover:underline">预览图片</span>
                            <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg group-hover:block">
                              <img src={item.previewUrl} alt="preview" className="h-auto w-full rounded object-contain" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleRestore(item)}
                    disabled={loading}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    恢复
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="p-[14px_24px] bg-[var(--color-bg)] border-t border-[var(--color-border-light)] flex justify-between gap-2.5">
          <button className="inline-flex items-center rounded-lg border border-[var(--color-danger)] bg-transparent px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void handleClear()} disabled={loading || items.length === 0}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            清空回收站
          </button>
          <button className="rounded-lg border-none bg-[var(--color-hover-bg)] px-5 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose} disabled={loading}>关闭</button>
        </div>
      </div>
    </div>
  )
}
