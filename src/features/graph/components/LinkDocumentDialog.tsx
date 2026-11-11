import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileText, Search, SearchX, X } from 'lucide-react'
import { useStorage } from '../../../core/storage'
import type { FSBDocumentCandidate } from '../../../core/fs-backend'
import { MAX_LINKED_DOCUMENTS, type LinkedDocumentRef } from '../../../domain/graph/linkedDocuments'
import {
  modalOverlayBaseClassName,
  modalOverlayEnterClassName,
  modalPanelEnterClassName,
} from '../../../shared/ui/modal'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { toast } from '../../../shared/ui/Toaster/toastStore'
import { syncLinkedDocumentsToGraph, useLinkedDocumentStore } from '../linkedDocumentStore'

/**
 * 「关联已有文档」选择器：全库文档平铺搜索 + 多选，一次写回节点的 linkedDocuments。
 * 挂载在 App 根，全局只有一个实例；保存结果广播给所有标签页的画布内存。
 */
export const LinkDocumentDialog = memo(function LinkDocumentDialog() {
  const dialog = useLinkedDocumentStore((s) => s.dialog)
  const closeDialog = useLinkedDocumentStore((s) => s.closeDialog)
  const storage = useStorage()
  const [candidates, setCandidates] = useState<FSBDocumentCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dialog) return
    let cancelled = false
    setQuery('')
    setSelected(new Set(dialog.links.map((link) => link.docId)))
    setLoading(true)
    void storage.listDocumentCandidates()
      .then((list) => { if (!cancelled) setCandidates(list) })
      .catch((error) => {
        toast({ level: 'error', title: '读取文档列表失败', message: (error as Error)?.message || String(error) })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    inputRef.current?.focus()
    return () => { cancelled = true }
  }, [dialog, storage])

  useEffect(() => {
    if (dialog) inputRef.current?.focus()
  }, [dialog])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((item) => (
      item.title.toLowerCase().includes(q)
      || item.breadcrumb.toLowerCase().includes(q)
      // 同名文档靠节点内文档树路径区分，路径本身也要可被检索。
      || item.documentPathLabel.toLowerCase().includes(q)
    ))
  }, [candidates, query])

  if (!dialog) return null

  const toggle = (docId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const save = async () => {
    if (saving || selected.size > MAX_LINKED_DOCUMENTS) return
    setSaving(true)
    try {
      const nextLinks: LinkedDocumentRef[] = candidates
        .filter((item) => selected.has(item.docId))
        .map((item) => ({
          docId: item.docId,
          // 用扫描出的真实位置作为定位缓存，标题也刷新成真实标题
          cardRef: item.cardPath,
          title: item.title,
        }))
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
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div id="link-document-dialog-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">关联已有文档</div>
          <button type="button" onClick={closeDialog} className="p-1 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-1.5 text-[12px] leading-snug text-[var(--color-text-muted)]">
          为「{dialog.label}」选择要关联的文档，最多 {MAX_LINKED_DOCUMENTS} 篇。关联文档可在右栏直接阅读与编辑，内容仍保存在原节点下。
        </div>
        <div className="flex items-center px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档标题、所属节点或节点内文档路径…"
            className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] min-w-0"
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {loading ? (
            <div className="py-8 text-center text-[13px] text-[var(--color-text-muted)]">加载文档中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState size="sm" icon={<SearchX className="h-4 w-4" />} title="没有匹配的文档" />
          ) : (
            filtered.map((item) => {
              const isSelected = selected.has(item.docId)
              const isSelf = item.cardPath === dialog.cardPath
              return (
                <button
                  key={`${item.cardPath}/${item.docId}`}
                  type="button"
                  data-tm-link-document-id={item.docId}
                  data-tm-link-document-path={item.documentPathLabel}
                  onClick={() => toggle(item.docId)}
                  className={`flex items-start gap-2.5 w-full px-3 py-2 text-left text-[13px] transition-colors ${
                    isSelected ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-bg-muted)]'
                  }`}
                >
                  <span className={`mt-[2px] flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                    isSelected
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-text-inverse)]'
                      : 'border-[var(--color-border)]'
                  }`}>
                    {isSelected && <Check className="w-3 h-3" />}
                  </span>
                  <FileText className="w-4 h-4 mt-[2px] shrink-0 text-[var(--color-text-muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--color-text-primary)]">{item.title}</span>
                    <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                      {isSelf ? '本节点 · ' : ''}{item.breadcrumb}
                    </span>
                    {/* 同一节点内可以有多篇同名文档，只有节点内树路径能区分引用的是哪一篇。 */}
                    {item.documentPathLabel && (
                      <span
                        className="block truncate text-[11px] text-[var(--color-text-secondary)]"
                        title={`节点内文档路径：${item.documentPathLabel}`}
                        data-tm-link-document-path-label=""
                      >
                        ↳ {item.documentPathLabel}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
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
              disabled={saving || loading || selected.size > MAX_LINKED_DOCUMENTS}
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
