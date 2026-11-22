import { memo } from 'react'
import { ExternalLink, FileText, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ResolvedLinkedDocument } from '../../../../domain/graph/linkedDocuments'
import { PANEL_LIST, PanelListAction } from '../../../../shared/ui/panelList'
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
      <div className={PANEL_LIST.header}>
        <Link2 className={PANEL_LIST.headerIcon} />
        <span className={PANEL_LIST.title}>关联文档</span>
        <span className={PANEL_LIST.count}>{links.length} / 8</span>
        <button
          type="button"
          onClick={onAdd}
          className={PANEL_LIST.addButton}
          title="关联已有文档"
        >
          <Plus className="h-3.5 w-3.5" /> 添加
        </button>
      </div>
      <div className={PANEL_LIST.body}>
        {loading && links.length === 0 ? (
          <div className={PANEL_LIST.empty}>解析关联中…</div>
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
                  className={`${PANEL_LIST.row} !items-start !gap-2 ${isActive ? PANEL_LIST.rowActive : ''}`}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(link.docId)}
                    className="flex min-w-0 flex-1 items-start gap-1.5 text-left border-none bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed"
                    title={disabled ? '文档已失效或在回收站' : link.title}
                  >
                    <FileText className={`mt-[2px] ${isActive ? PANEL_LIST.iconActive : PANEL_LIST.icon}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] ${isActive ? PANEL_LIST.rowTitleActive : 'text-[var(--color-text-primary)]'} ${disabled ? 'opacity-60' : ''}`}>
                        {link.title || '未命名文档'}
                      </span>
                      {/* 来源面包屑独占一行且以「来源：」开头；状态徽章另起 span，不污染文本匹配。 */}
                      <span className="flex items-center gap-1">
                        <span className={`${PANEL_LIST.rowMeta} min-w-0 flex-1`}>来源：{link.sourceLabel || '未知位置'}</span>
                        {link.status === 'trashed' && (
                          <span className={`${PANEL_LIST.badge} ${PANEL_LIST.badgeWarning}`}>回收站</span>
                        )}
                        {link.status === 'missing' && (
                          <span className={`${PANEL_LIST.badge} ${PANEL_LIST.badgeDanger}`}>已删除</span>
                        )}
                      </span>
                    </span>
                  </button>
                  {/* 与文档树列表一致：工具显隐只跟随鼠标 hover，与选中态 / 焦点态无关；
                      未 hover 时不进入布局、不预留右侧宽度，hover 时才插入。 */}
                  <div data-tm-overlay="none" className="h-4 shrink-0 items-center gap-0.5 tm-fade-enter hidden group-hover:!flex">
                    {link.status === 'trashed' && (
                      <PanelListAction title="从回收站恢复" onClick={() => onRestore(link)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </PanelListAction>
                    )}
                    {link.status === 'ok' && (
                      <PanelListAction title="在所属节点打开" onClick={() => onOpenOwner(link)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </PanelListAction>
                    )}
                    <PanelListAction
                      title="移除关联"
                      className="hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]"
                      onClick={() => onRemove(link.docId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </PanelListAction>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className={PANEL_LIST.footer}>最多关联 8 篇 · 内容始终保存在所属节点</div>
    </div>
  )
})
