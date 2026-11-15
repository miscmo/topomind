import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search, SearchX, X } from 'lucide-react'
import { useStorage } from '../../../core/storage'
import type { FSBDocumentCandidate, UnifiedTreeNode } from '../../../core/fs-backend'
import { MAX_LINKED_DOCUMENTS, type LinkedDocumentRef } from '../../../domain/graph/linkedDocuments'
import {
  modalOverlayBaseClassName,
  modalOverlayEnterClassName,
  modalPanelEnterClassName,
} from '../../../shared/ui/modal'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { toast } from '../../../shared/ui/Toaster/toastStore'
import { createStorageTreeDataSource } from '../../documents/unifiedTree/createStorageTreeDataSource'
import { DocumentCandidateRow } from '../../documents/unifiedTree/DocumentCandidateRow'
import { UnifiedTreeView } from '../../documents/unifiedTree/UnifiedTreeView'
import { useUnifiedTree } from '../../documents/unifiedTree/useUnifiedTree'
import { useUnifiedTreeSearch } from '../../documents/unifiedTree/useUnifiedTreeSearch'
import { syncLinkedDocumentsToGraph, useLinkedDocumentStore, type LinkedDocumentDialogState } from '../linkedDocumentStore'

const ID_ATTRIBUTE = 'data-tm-link-document-id'
const PATH_ATTRIBUTE = 'data-tm-link-document-path'
const PATH_LABEL_ATTRIBUTE = 'data-tm-link-document-path-label'

/**
 * 「关联已有文档」选择器：默认只加载统一资源树的顶层根，展开哪层才加载哪层；
 * 输入搜索才跨层检索（走主进程派生索引）。一次写回节点的 linkedDocuments。
 * 挂载在 App 根，全局只有一个实例；保存结果广播给所有标签页的画布内存。
 */
export const LinkDocumentDialog = memo(function LinkDocumentDialog() {
  const dialog = useLinkedDocumentStore((s) => s.dialog)
  if (!dialog) return null
  // key 让「弹窗开着又切到另一个节点」也重新挂载一次：树缓存与已见候选全部清空，
  // 无需 refresh，也就不会出现打开瞬间两次 root 层查询。
  return <LinkDocumentDialogBody key={`${dialog.nodeId}:${dialog.cardPath}`} dialog={dialog} />
})

/**
 * 数据层只在弹窗打开时挂载。App 根常驻的是上面的外壳：启动阶段还在 setup 视图、
 * currentWorkDir 为 null（SetupPage 的自动恢复是异步 IPC），若在外壳里直接调
 * useUnifiedTree，它挂载即加载 root 层会让 requireRootDir() 抛「未选择工作目录」，
 * 每次启动都往控制台刷一条 error。关闭弹窗时 Body 卸载，缓存与 error 一并清空。
 */
const LinkDocumentDialogBody = memo(function LinkDocumentDialogBody({ dialog }: { dialog: LinkedDocumentDialogState }) {
  const closeDialog = useLinkedDocumentStore((s) => s.closeDialog)
  const storage = useStorage()
  const dataSource = useMemo(() => createStorageTreeDataSource(storage), [storage])
  const tree = useUnifiedTree(dataSource)
  const search = useUnifiedTreeSearch(dataSource)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showSelected, setShowSelected] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 见过的候选（树层 / 搜索结果）留作保存时的 cardRef / 标题来源。 */
  const knownCandidates = useRef(new Map<string, FSBDocumentCandidate>())

  // Body 每次打开都是全新挂载：useUnifiedTree 已恰好加载一次 root 层，这里只做表单
  // 初始化。刻意不再调用刷新方法，否则打开瞬间会并发两次 listUnifiedTreeLevel
  // ('root')，违背「打开只查一层」的契约。dialog 在打开期间被替换时只重置表单，
  // 树缓存仍是同一工作目录，不必重扫。
  useEffect(() => {
    knownCandidates.current.clear()
    setSelected(new Set(dialog.links.map((link) => link.docId)))
    setShowSelected(false)
    setActiveIndex(0)
    search.setQuery('')
    inputRef.current?.focus()
  }, [dialog, storage]) // eslint-disable-line react-hooks/exhaustive-deps

  // 展开过的层与搜索结果都登记进候选表：收起分支后仍能正确保存已勾选文档。
  useEffect(() => {
    for (const row of tree.rows) {
      if (row.node.candidate) knownCandidates.current.set(row.node.candidate.docId, row.node.candidate)
    }
  }, [tree.rows])
  useEffect(() => {
    for (const item of search.results) knownCandidates.current.set(item.docId, item)
  }, [search.results])

  const toggle = useCallback((docId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }, [])

  const activateNode = useCallback((node: UnifiedTreeNode) => {
    const candidate = node.candidate
    if (!candidate) return
    knownCandidates.current.set(candidate.docId, candidate)
    toggle(candidate.docId)
  }, [toggle])

  const selectedLinks = useMemo(() => {
    const linkById = new Map((dialog?.links ?? []).map((link) => [link.docId, link]))
    return [...selected].map((docId) => ({
      docId,
      title: knownCandidates.current.get(docId)?.title || linkById.get(docId)?.title || '未命名文档',
    }))
  }, [selected, dialog, tree.rows, search.results]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (saving || selected.size > MAX_LINKED_DOCUMENTS) return
    setSaving(true)
    try {
      const linkById = new Map(dialog.links.map((link) => [link.docId, link]))
      const nextLinks: LinkedDocumentRef[] = [...selected].flatMap((docId) => {
        const candidate = knownCandidates.current.get(docId)
        // 用扫描出的真实位置作为定位缓存，标题也刷新成真实标题。
        if (candidate) return [{ docId, cardRef: candidate.cardPath, title: candidate.title }]
        const previous = linkById.get(docId)
        // 已关联但本次未展开到该文档：沿用原记录，绝不凭空丢失。
        return previous ? [{ docId, cardRef: previous.cardRef, title: previous.title }] : []
      })
      const saved = await storage.updateNodeLinkedDocuments(dialog.cardPath, nextLinks)
      syncLinkedDocumentsToGraph(dialog.nodeId, saved)
      toast({ level: 'info', title: '关联已更新', message: `已关联 ${saved.length} 篇文档` })
      closeDialog()
    } catch (error) {
      toast({ level: 'error', title: '保存关联失败', message: (error as Error)?.message || String(error) })
    } finally {
      setSaving(false)
    }
  }

  const isBusy = tree.loadingRoot || search.loading

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onMouseDown={closeDialog}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeDialog() }
      }}
    >
      <div
        className={`w-[460px] max-w-[92vw] bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl overflow-hidden ${modalPanelEnterClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-document-dialog-title"
        data-tm-link-document-tree=""
        data-tm-link-document-levels={tree.loadCount}
        data-tm-link-document-search={search.isSearching ? 'true' : 'false'}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div id="link-document-dialog-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">关联已有文档</div>
          <button type="button" onClick={closeDialog} className="p-1 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-1.5 text-[12px] leading-snug text-[var(--color-text-muted)]">
          为「{dialog.label}」选择文档，最多 {MAX_LINKED_DOCUMENTS} 篇。按节点树逐层展开，或搜索直达；内容仍保存在原节点下。
        </div>
        <div className="flex items-center px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            placeholder="搜索文档标题、所属节点或节点内路径…"
            className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] min-w-0"
          />
          <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]" title="按层加载的次数">
            {tree.loadCount} 层
          </span>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {search.isSearching ? (
            search.loading ? (
              <div className="py-8 text-center text-[13px] text-[var(--color-text-muted)]">搜索中…</div>
            ) : search.error ? (
              <div className="py-8 text-center text-[13px] text-[var(--color-danger)]">搜索失败：{search.error}</div>
            ) : search.results.length === 0 ? (
              <EmptyState size="sm" icon={<SearchX className="h-4 w-4" />} title="没有匹配的文档" />
            ) : (
              <div className="py-1" data-tm-link-document-search-results={search.results.length}>
                {search.results.map((item, index) => (
                  <DocumentCandidateRow
                    key={`${item.cardPath}/${item.docId}`}
                    candidate={item}
                    idAttribute={ID_ATTRIBUTE}
                    pathAttribute={PATH_ATTRIBUTE}
                    pathLabelAttribute={PATH_LABEL_ATTRIBUTE}
                    showCheckbox
                    selected={selected.has(item.docId)}
                    active={index === activeIndex}
                    isSelf={item.cardPath === dialog.cardPath}
                    onMouseEnter={() => setActiveIndex(index)}
                    onPick={() => { knownCandidates.current.set(item.docId, item); toggle(item.docId) }}
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
              mode="multi"
              selectedIds={selected}
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
        {selected.size > 0 ? (
          <div className="border-t border-[var(--color-border-subtle)] px-4 py-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              onClick={() => setShowSelected((value) => !value)}
            >
              {showSelected ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              已选 {selected.size} 篇 · 查看
            </button>
            {showSelected ? (
              <div className="mt-1.5 flex max-h-20 flex-wrap gap-1 overflow-y-auto" data-tm-link-document-selected="">
                {selectedLinks.map((link) => (
                  <button
                    key={link.docId}
                    type="button"
                    title="取消选择"
                    onClick={() => toggle(link.docId)}
                    className="max-w-[180px] truncate rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]"
                  >
                    {link.title} ×
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-border-subtle)]">
          <span className={`text-[12px] ${selected.size > MAX_LINKED_DOCUMENTS ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}>
            已选 {selected.size} / {MAX_LINKED_DOCUMENTS}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={closeDialog} className="px-3 py-1.5 rounded-md text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">
              取消
            </button>
            <button
              type="button"
              onClick={() => { void save() }}
              disabled={saving || isBusy || selected.size > MAX_LINKED_DOCUMENTS}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-[var(--color-text-inverse)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
