import { memo } from 'react'
import { ArrowDownRight, ArrowUpRight, FileText, Link2, RefreshCw } from 'lucide-react'
import type { DocumentBacklink } from '../../../../domain/graph/linkedDocuments'
import { EmptyState } from '../../../../shared/ui/EmptyState'

interface DocumentRelationPanelProps {
  /** 其它文档中引用了当前文档的（入链） */
  incoming: DocumentBacklink[]
  /** 当前文档中引用了的文档（出链） */
  outgoing: DocumentBacklink[]
  loading: boolean
  /** 主进程本轮真正读正文解析的篇数：0 表示完全命中关系索引 */
  parsed: number
  indexed: number
  onOpen: (docId: string) => void
  onRefresh: () => void
}

interface RelationRowProps {
  item: DocumentBacklink
  kind: 'incoming' | 'outgoing'
  onOpen: (docId: string) => void
}

const RelationRow = memo(function RelationRow({ item, kind, onOpen }: RelationRowProps) {
  const missing = item.status === 'missing'
  const isOutgoing = kind === 'outgoing'
  return (
    <button
      type="button"
      data-tm-backlink-item={isOutgoing ? undefined : item.docId}
      data-tm-outgoing-item={isOutgoing ? item.docId : undefined}
      disabled={missing}
      onClick={() => onOpen(item.docId)}
      className="flex items-start gap-2 w-full px-2 py-1.5 rounded-md text-left hover:bg-[var(--color-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed border-none bg-transparent cursor-pointer"
      title={missing ? '引用的文档已不存在' : `打开「${item.title || item.docId}」`}
    >
      <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-[var(--color-text-primary)]">
          {item.title || '未命名文档'}
        </span>
        <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
          {missing ? '文档已不存在' : `来源：${item.breadcrumb}`}
        </span>
        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[var(--color-accent)]">
          {isOutgoing
            ? <ArrowDownRight className="h-3 w-3" />
            : <ArrowUpRight className="h-3 w-3" />}
          {item.references} 处引用
        </span>
      </span>
    </button>
  )
})

interface RelationSectionProps {
  kind: 'incoming' | 'outgoing'
  title: string
  hint: string
  items: DocumentBacklink[]
  emptyTitle: string
  emptyDescription: string
  onOpen: (docId: string) => void
}

const RelationSection = memo(function RelationSection({
  kind, title, hint, items, emptyTitle, emptyDescription, onOpen,
}: RelationSectionProps) {
  const totalReferences = items.reduce((sum, item) => sum + item.references, 0)
  return (
    <section
      className="flex-1 min-h-0 flex flex-col"
      data-tm-relations-incoming={kind === 'incoming' ? '' : undefined}
      data-tm-relations-outgoing={kind === 'outgoing' ? '' : undefined}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 bg-[var(--color-bg-muted)]">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]" title={hint}>
          {title}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
          {items.length} 篇 · {totalReferences} 处
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
        {items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Link2 className="h-4 w-4" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <RelationRow key={`${kind}/${item.cardPath}/${item.docId}`} item={item} kind={kind} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
})

/**
 * 「引用关系」侧栏页：上下两栏分别展示入链（谁引用了本页）与出链（本页引用了谁）。
 * 两栏共用主进程一次索引校验的结果，条目都按稳定 docId 在右栏打开，可跨节点 / 跨房间。
 */
export const DocumentRelationPanel = memo(function DocumentRelationPanel({
  incoming,
  outgoing,
  loading,
  parsed,
  indexed,
  onOpen,
  onRefresh,
}: DocumentRelationPanelProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-tm-backlinks-panel="">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">引用关系</span>
        <div className="flex items-center gap-1.5 min-w-0">
          {loading && <span className="text-[10px] text-[var(--color-text-muted)]">校验中…</span>}
          {!loading && (
            <span
              className="text-[10px] text-[var(--color-text-muted)] truncate"
              title="关系索引覆盖的文档数 / 本次真正读正文解析的篇数（0 表示完全命中索引）"
            >
              索引 {indexed} 篇 · 解析 {parsed}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="p-1 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] border-none bg-transparent cursor-pointer shrink-0"
            title="重新校验全库引用关系（只重新解析改动过的正文）"
            aria-label="重新校验引用关系"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <RelationSection
        kind="incoming"
        title="引用了本页"
        hint="其它文档的正文里引用了当前文档"
        items={incoming}
        emptyTitle="还没有文档引用本文"
        emptyDescription="在其它文档里输入 [[ 即可插入引用"
        onOpen={onOpen}
      />

      <div className="h-px shrink-0 bg-[var(--color-border-subtle)]" />

      <RelationSection
        kind="outgoing"
        title="本页引用了"
        hint="当前文档的正文里引用了哪些文档"
        items={outgoing}
        emptyTitle="本文还没有引用其它文档"
        emptyDescription="输入 [[ 或斜杠菜单「引用文档」即可插入"
        onOpen={onOpen}
      />
    </div>
  )
})
