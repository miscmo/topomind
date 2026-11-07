import { memo } from 'react'
import { ArrowUpRight, FileText, Link2, RefreshCw } from 'lucide-react'
import type { DocumentBacklink } from '../../../../domain/graph/linkedDocuments'
import { EmptyState } from '../../../../shared/ui/EmptyState'

interface DocumentBacklinkListProps {
  items: DocumentBacklink[]
  loading: boolean
  onOpen: (docId: string) => void
  onRefresh: () => void
}

/**
 * 「被引用」侧栏页：列出全库中正文含有指向当前文档 docLink 的文档。
 * 点击条目直接按 docId 在右栏打开引用者，可跨节点 / 跨房间。
 */
export const DocumentBacklinkList = memo(function DocumentBacklinkList({
  items,
  loading,
  onOpen,
  onRefresh,
}: DocumentBacklinkListProps) {
  const totalReferences = items.reduce((sum, item) => sum + item.references, 0)

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-tm-backlinks-panel="">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
          被引 {items.length} 篇 · {totalReferences} 处
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="p-1 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] border-none bg-transparent cursor-pointer"
          title="重新扫描全库引用"
          aria-label="重新扫描全库引用"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
        {loading && items.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">扫描全库引用中…</div>
        ) : items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Link2 className="h-4 w-4" />}
            title="还没有文档引用本文"
            description="在其它文档里输入 [[ 即可插入引用"
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <button
                key={`${item.cardPath}/${item.docId}`}
                type="button"
                data-tm-backlink-item={item.docId}
                onClick={() => onOpen(item.docId)}
                className="flex items-start gap-2 w-full px-2 py-1.5 rounded-md text-left hover:bg-[var(--color-hover-bg)] border-none bg-transparent cursor-pointer"
                title={`打开「${item.title}」`}
              >
                <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-[var(--color-text-primary)]">{item.title}</span>
                  <span className="block truncate text-[10px] text-[var(--color-text-muted)]">来源：{item.breadcrumb}</span>
                  <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[var(--color-accent)]">
                    <ArrowUpRight className="h-3 w-3" /> {item.references} 处引用
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
