import { memo } from 'react'
import { Check, ChevronDown, ChevronRight, FileText, Folder, GitBranch, Layers, Loader2 } from 'lucide-react'
import type { UnifiedTreeNode } from '../../../core/fs-backend'
import type { UnifiedTreeRow } from './types'

interface UnifiedTreeViewProps {
  rows: UnifiedTreeRow[]
  loadingRoot: boolean
  /** 累计按层请求次数，暴露到 DOM 便于回归验证「打开只加载一层」。 */
  loadCount: number
  error: string | null
  mode: 'single' | 'multi'
  selectedIds: Set<string>
  excludedDocIds?: Set<string>
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onToggleExpand: (key: string) => void
  /** 点击可选文档（勾选 / 插入）时触发。 */
  onActivate: (node: UnifiedTreeNode) => void
  /** 两套旧诊断属性名由调用方注入，避免在这里写死业务方名称。 */
  idAttribute: string
  pathAttribute: string
  pathLabelAttribute: string
  className?: string
  emptyText?: string
}

const ICON_CLASS = 'mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]'

/** 来源标签由主进程的 origin 决定；渲染层不解析不透明 key，也不自己猜层级。 */
const ORIGIN_LABEL: Record<NonNullable<UnifiedTreeNode['origin']>, string> = {
  room: '房间',
  subordinate: '从属',
  path: '仅路径',
}

function NodeIcon({ node }: { node: UnifiedTreeNode }) {
  if (node.kind === 'group') return <Layers className={ICON_CLASS} />
  if (node.kind === 'document') return <FileText className={ICON_CLASS} />
  if (node.origin === 'subordinate') return <GitBranch className={ICON_CLASS} />
  return <Folder className={ICON_CLASS} />
}

/**
 * 通用统一树视图：只消费不透明 key + kind，不认识具体的节点/文档规则。
 * 诊断属性与两处旧平铺列表保持一致，搜索结果行也复用同一套属性名。
 */
export const UnifiedTreeView = memo(function UnifiedTreeView({
  rows,
  loadingRoot,
  loadCount,
  error,
  mode,
  selectedIds,
  excludedDocIds,
  activeIndex,
  onActiveIndexChange,
  onToggleExpand,
  onActivate,
  idAttribute,
  pathAttribute,
  pathLabelAttribute,
  className = '',
  emptyText = '暂无内容',
}: UnifiedTreeViewProps) {
  return (
    <div
      className={`py-1 ${className}`}
      role="tree"
      data-tm-unified-tree=""
      data-tm-unified-tree-levels={loadCount}
      data-tm-unified-tree-rows={rows.length}
      data-tm-unified-tree-mode={mode}
    >
      {loadingRoot ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--color-text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
        </div>
      ) : error ? (
        <div className="px-3 py-6 text-center text-[12px] text-[var(--color-danger)]">加载失败：{error}</div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-[var(--color-text-muted)]">{emptyText}</div>
      ) : (
        rows.map((row, index) => {
          const { node } = row
          const docId = node.candidate?.docId ?? ''
          const isSelected = Boolean(docId) && selectedIds.has(docId)
          const isExcluded = Boolean(docId) && Boolean(excludedDocIds?.has(docId))
          const isActive = index === activeIndex
          const docAttrs = node.candidate ? {
            [idAttribute]: docId,
            [pathAttribute]: node.candidate.documentPathLabel,
            'data-tm-unified-tree-doc-id': docId,
          } : {}
          return (
            <div
              key={node.key}
              role="treeitem"
              aria-expanded={node.hasChildren ? row.expanded : undefined}
              aria-selected={mode === 'multi' ? isSelected : undefined}
              data-tm-unified-tree-node={node.kind}
              data-tm-unified-tree-key={node.key}
              data-tm-unified-tree-depth={row.depth}
              data-tm-unified-tree-origin={node.origin}
              data-tm-unified-tree-has-docs={node.hasDocuments === undefined ? undefined : String(node.hasDocuments)}
              data-tm-unified-tree-orphan={node.orphan ? 'true' : undefined}
              className={node.origin === 'path' ? 'opacity-55' : undefined}
              style={{ paddingLeft: row.depth * 14 }}
              {...docAttrs}
            >
              <div className={`flex items-stretch transition-colors ${
                isSelected ? 'bg-[var(--color-accent-soft)]'
                  : isActive ? 'bg-[var(--color-hover-bg)]' : 'hover:bg-[var(--color-hover-bg)]'
              } ${isExcluded ? 'opacity-40' : ''}`}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={row.expanded ? '收起' : '展开'}
                  className="flex w-6 shrink-0 items-start justify-center pt-[7px] text-[var(--color-text-muted)] disabled:opacity-30"
                  disabled={!node.hasChildren || row.loading}
                  onClick={() => onToggleExpand(node.key)}
                >
                  {row.loading
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : node.hasChildren
                      ? row.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                      : <span className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 py-1.5 pr-2 text-left"
                  disabled={isExcluded}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onClick={() => node.selectable ? onActivate(node) : onToggleExpand(node.key)}
                >
                  <NodeIcon node={node} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-[var(--color-text-primary)]">{node.label}</span>
                    <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                      {node.origin ? (
                        <span
                          className={`mr-1.5 rounded px-1 py-[1px] text-[10px] ${
                            node.origin === 'subordinate'
                              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                              : 'bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)]'
                          }`}
                        >{ORIGIN_LABEL[node.origin]}</span>
                      ) : null}
                      {node.subtitle}{node.orphan ? ' · 离散' : ''}
                    </span>
                    {node.candidate?.documentPathLabel ? (
                      <span
                        className="block truncate text-[11px] text-[var(--color-text-secondary)]"
                        title={`节点内文档路径：${node.candidate.documentPathLabel}`}
                        {...{ [pathLabelAttribute]: '' }}
                      >
                        ↳ {node.candidate.documentPathLabel}
                      </span>
                    ) : null}
                  </span>
                  {mode === 'multi' && isSelected ? (
                    <Check className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
                  ) : null}
                </button>
              </div>
              {row.expanded && row.loading ? (
                <div className="py-1 pl-8 text-[11px] text-[var(--color-text-muted)]">加载中…</div>
              ) : null}
            </div>
          )
        })
      )}
    </div>
  )
})
