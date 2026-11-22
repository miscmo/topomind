import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Search, SearchX } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import type { FSBDocumentCandidate, UnifiedTreeNode } from '../../../../core/fs-backend'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
import { createStorageTreeDataSource } from '../../unifiedTree/createStorageTreeDataSource'
import { DocumentCandidateRow } from '../../unifiedTree/DocumentCandidateRow'
import { UnifiedTreeView } from '../../unifiedTree/UnifiedTreeView'
import { useUnifiedTree } from '../../unifiedTree/useUnifiedTree'
import { useUnifiedTreeSearch } from '../../unifiedTree/useUnifiedTreeSearch'
import type { DocumentLinkPickerRect } from '../docLinkBridge'

const PICKER_WIDTH = 320
const PICKER_MAX_HEIGHT = 300
const EDGE_MARGIN = 8
const ID_ATTRIBUTE = 'data-tm-doc-link-item'
const PATH_ATTRIBUTE = 'data-tm-doc-link-path'
const PATH_LABEL_ATTRIBUTE = 'data-tm-doc-link-path-label'
const EMPTY_SELECTED = new Set<string>()

interface DocumentLinkPickerProps {
  rect: DocumentLinkPickerRect
  /** 当前文档 id，不允许引用自己（自引用不算反向链接）。 */
  excludeDocId?: string
  onPick: (candidate: FSBDocumentCandidate) => void
  onClose: () => void
}

/**
 * `[[` / 斜杠菜单触发的文档选择器：默认只加载统一资源树顶层，逐层展开按需读取；
 * 输入搜索才跨层检索（主进程派生索引）。一律 portal 到 document.body：浮层挂在
 * 编辑器 DOM 里会被 ProseMirror 当成可编辑内容，也会被 .bn-editor 的 overflow 裁掉。
 */
export const DocumentLinkPicker = memo(function DocumentLinkPicker({
  rect,
  excludeDocId,
  onPick,
  onClose,
}: DocumentLinkPickerProps) {
  const storage = useStorage()
  const dataSource = useMemo(() => createStorageTreeDataSource(storage), [storage])
  const tree = useUnifiedTree(dataSource)
  const search = useUnifiedTreeSearch(dataSource)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActiveIndex(0) }, [search.query, search.isSearching])

  // 点击浮层之外 / Esc 关闭；捕获阶段监听，避免编辑器把这次点击当成文本选区变化。
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && rootRef.current?.contains(event.target)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  useEffect(() => {
    if (!tree.error) return
    toast({ level: 'error', title: '读取文档树失败', message: tree.error })
  }, [tree.error])

  const visibleResults = useMemo(
    () => search.results.filter((item) => !excludeDocId || item.docId !== excludeDocId),
    [search.results, excludeDocId],
  )
  const excludedDocIds = useMemo(
    () => new Set(excludeDocId ? [excludeDocId] : []),
    [excludeDocId],
  )

  const pick = useCallback((candidate: FSBDocumentCandidate) => {
    onPick(candidate)
    onClose()
  }, [onPick, onClose])

  const activateNode = useCallback((node: UnifiedTreeNode) => {
    if (node.candidate) pick(node.candidate)
    else if (node.hasChildren) tree.toggle(node.key)
  }, [pick, tree])

  const visibleCount = search.isSearching ? visibleResults.length : tree.rows.length
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, visibleCount - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(current - 1, 0))
    } else if (event.key === 'ArrowRight' && !search.isSearching) {
      const row = tree.rows[activeIndex]
      if (row?.node.hasChildren && !row.expanded) { event.preventDefault(); tree.toggle(row.node.key) }
    } else if (event.key === 'ArrowLeft' && !search.isSearching) {
      const row = tree.rows[activeIndex]
      if (row?.expanded) { event.preventDefault(); tree.toggle(row.node.key) }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (search.isSearching) {
        const candidate = visibleResults[activeIndex]
        if (candidate) pick(candidate)
      } else {
        const row = tree.rows[activeIndex]
        if (row) activateNode(row.node)
      }
    }
  }

  const position = useMemo(() => {
    let top = rect.bottom + 6
    if (top + PICKER_MAX_HEIGHT + EDGE_MARGIN > window.innerHeight) {
      top = Math.max(EDGE_MARGIN, rect.top - PICKER_MAX_HEIGHT - 6)
    }
    let left = rect.left
    if (left + PICKER_WIDTH + EDGE_MARGIN > window.innerWidth) {
      left = window.innerWidth - PICKER_WIDTH - EDGE_MARGIN
    }
    return { top: Math.max(EDGE_MARGIN, top), left: Math.max(EDGE_MARGIN, left) }
  }, [rect])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={rootRef}
      className="tm-doc-link-picker tm-popover-enter fixed z-[10000] flex w-[320px] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label="引用文档"
      data-tm-doc-link-picker=""
      data-tm-doc-link-tree=""
      data-tm-doc-link-levels={tree.loadCount}
      data-tm-doc-link-search={search.isSearching ? 'true' : 'false'}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索标题、所属节点或节点内路径…"
          className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
        <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]" title="按层加载的次数">{tree.loadCount} 层</span>
      </div>
      <div className="max-h-[248px] overflow-y-auto">
        {search.isSearching ? (
          search.loading ? (
            <div className="py-6 text-center text-[12px] text-[var(--color-text-muted)]">搜索中…</div>
          ) : search.error ? (
            <div className="py-6 text-center text-[12px] text-[var(--color-danger)]">搜索失败：{search.error}</div>
          ) : visibleResults.length === 0 ? (
            <EmptyState size="sm" icon={<SearchX className="h-4 w-4" />} title="没有匹配的文档" />
          ) : (
            <div className="py-1" data-tm-doc-link-search-results={visibleResults.length}>
              {visibleResults.map((item, index) => (
                <DocumentCandidateRow
                  key={`${item.cardPath}/${item.docId}`}
                  candidate={item}
                  idAttribute={ID_ATTRIBUTE}
                  pathAttribute={PATH_ATTRIBUTE}
                  pathLabelAttribute={PATH_LABEL_ATTRIBUTE}
                  active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onPick={() => pick(item)}
                />
              ))}
            </div>
          )
        ) : (
          <UnifiedTreeView
            rows={tree.rows}
            loadingRoot={tree.loadingRoot}
            loadCount={tree.loadCount}
            error={tree.error}
            mode="single"
            selectedIds={EMPTY_SELECTED}
            excludedDocIds={excludedDocIds}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onToggleExpand={tree.toggle}
            onActivate={activateNode}
            idAttribute={ID_ATTRIBUTE}
            pathAttribute={PATH_ATTRIBUTE}
            pathLabelAttribute={PATH_LABEL_ATTRIBUTE}
            emptyText="暂无节点与文档"
          />
        )}
      </div>
      <div className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)]">
        ↑↓ 选择 · → 展开 · Enter 插入 · Esc 取消
      </div>
    </div>,
    document.body,
  )
})
