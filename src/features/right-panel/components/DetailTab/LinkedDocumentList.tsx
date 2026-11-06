import { memo } from 'react'
import { AlertCircle, ExternalLink, FileText, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ResolvedLinkedDocument } from '../../../../domain/graph/linkedDocuments'
import { EmptyState } from '../../../../shared/ui/EmptyState'

interface LinkedDocumentListProps {
  links: ResolvedLinkedDocument[]
  activeDocId: string | null
  loading: boolean
  onSelect: (docId: string) => void
  onRemove: (docId: string) => void
  onRestore: (link: ResolvedLinkedDocument) => void
  onOpenOwner: (link: ResolvedLinkedDocument) => void
  onAdd: () => void
}

function displaySource(cardPath: string) {
  if (!cardPath) return '未知位置'
  const parts = cardPath.split('/').filter(Boolean)
  return parts.slice(0, -1).join(' / ') || '根节点'
}

/** 关联视图的侧栏：平铺的关联列表，不展示源节点的整棵文档树。 */
export const LinkedDocumentList = memo(function LinkedDocumentList({
  links,
  activeDocId,
  loading,
  onSelect,
  onRemove,
  onRestore,
  onOpenOwner,
  onAdd,
}: LinkedDocumentListProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">关联文档 · {links.length}</span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] border-none bg-transparent cursor-pointer"
          title="关联已有文档"
        >
          <Plus className="w-3.5 h-3.5" /> 添加
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
        {loading && links.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">解析关联中…</div>
        ) : links.length === 0 ? (
          <EmptyState size="sm" icon={<Link2 className="h-4 w-4" />} title="还没有关联文档" description="点击「添加」选择已有文档" />
        ) : (
          <div className="flex flex-col gap-0.5">
            {links.map((link) => {
              const isActive = link.docId === activeDocId
              const disabled = link.status !== 'ok'
              return (
                <div
                  key={link.docId}
                  className={`group flex items-start gap-2 px-2 py-1.5 rounded-md transition-colors ${
                    isActive ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-bg-muted)]'
                  }`}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(link.docId)}
                    className="flex items-start gap-2 flex-1 min-w-0 text-left border-none bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed"
                    title={disabled ? '文档已失效或在回收站' : link.title}
                  >
                    <FileText className={`w-3.5 h-3.5 mt-[2px] shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] ${isActive ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-primary)]'} ${disabled ? 'opacity-60' : ''}`}>
                        {link.title || '未命名文档'}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                        来源：{displaySource(link.cardPath || link.cardRef)}
                      </span>
                      {link.status === 'trashed' && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[var(--color-warning)]">
                          <AlertCircle className="w-3 h-3" /> 已在回收站
                        </span>
                      )}
                      {link.status === 'missing' && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[var(--color-danger)]">
                          <AlertCircle className="w-3 h-3" /> 文档已删除
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {link.status === 'trashed' && (
                      <button type="button" className="p-1 rounded hover:bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] border-none bg-transparent cursor-pointer" title="从回收站恢复" onClick={() => onRestore(link)}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {link.status === 'ok' && (
                      <button type="button" className="p-1 rounded hover:bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] border-none bg-transparent cursor-pointer" title="在所属节点打开" onClick={() => onOpenOwner(link)}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button type="button" className="p-1 rounded hover:bg-[var(--color-danger-soft)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] border-none bg-transparent cursor-pointer" title="移除关联" onClick={() => onRemove(link.docId)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
