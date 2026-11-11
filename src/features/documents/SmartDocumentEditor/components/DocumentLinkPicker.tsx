import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Search, SearchX } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import type { FSBDocumentCandidate } from '../../../../core/fs-backend'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
import type { DocumentLinkPickerRect } from '../docLinkBridge'

const PICKER_WIDTH = 320
const PICKER_MAX_HEIGHT = 300
const EDGE_MARGIN = 8

interface DocumentLinkPickerProps {
  rect: DocumentLinkPickerRect
  /** 当前文档 id，不允许引用自己（自引用不算反向链接）。 */
  excludeDocId?: string
  onPick: (candidate: FSBDocumentCandidate) => void
  onClose: () => void
}

/**
 * `[[` / 斜杠菜单触发的全库文档选择器。
 * 一律 portal 到 document.body：浮层挂在编辑器 DOM 里会被 ProseMirror 当成可编辑内容，
 * 也会被 .bn-editor 的 overflow / z-index 裁掉。
 */
export const DocumentLinkPicker = memo(function DocumentLinkPicker({
  rect,
  excludeDocId,
  onPick,
  onClose,
}: DocumentLinkPickerProps) {
  const storage = useStorage()
  const [candidates, setCandidates] = useState<FSBDocumentCandidate[]>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void storage.listDocumentCandidates()
      .then((list) => { if (!cancelled) setCandidates(list) })
      .catch((error) => {
        if (cancelled) return
        toast({ level: 'error', title: '读取文档列表失败', message: (error as Error)?.message || String(error) })
        setCandidates([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storage])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((item) => {
      if (excludeDocId && item.docId === excludeDocId) return false
      if (!q) return true
      return item.title.toLowerCase().includes(q)
        || item.breadcrumb.toLowerCase().includes(q)
        // 同名文档靠节点内文档树路径区分，路径本身也要可被检索。
        || item.documentPathLabel.toLowerCase().includes(q)
    }).slice(0, 80)
  }, [candidates, query, excludeDocId])

  useEffect(() => { setActiveIndex(0) }, [query])

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

  const pick = useCallback((candidate: FSBDocumentCandidate) => {
    onPick(candidate)
    onClose()
  }, [onPick, onClose])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const candidate = filtered[activeIndex]
      if (candidate) pick(candidate)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={rootRef}
      className="tm-doc-link-picker fixed z-[10000] flex w-[320px] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label="引用文档"
      data-tm-doc-link-picker=""
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索标题、所属节点或节点内文档路径…"
          className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>
      <div className="max-h-[248px] overflow-y-auto py-1">
        {loading ? (
          <div className="py-6 text-center text-[12px] text-[var(--color-text-muted)]">加载文档中…</div>
        ) : filtered.length === 0 ? (
          <EmptyState size="sm" icon={<SearchX className="h-4 w-4" />} title="没有匹配的文档" />
        ) : (
          filtered.map((item, index) => (
            <button
              key={`${item.cardPath}/${item.docId}`}
              type="button"
              data-tm-doc-link-item={item.docId}
              data-tm-doc-link-path={item.documentPathLabel}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
                index === activeIndex ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-hover-bg)]'
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(item)}
            >
              <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-[var(--color-text-primary)]">{item.title}</span>
                <span className="block truncate text-[11px] text-[var(--color-text-muted)]">{item.breadcrumb}</span>
                {/* 同一节点内可以有多篇同名文档，只有节点内树路径能区分引用的是哪一篇。 */}
                {item.documentPathLabel && (
                  <span
                    className="block truncate text-[11px] text-[var(--color-text-secondary)]"
                    title={`节点内文档路径：${item.documentPathLabel}`}
                    data-tm-doc-link-path-label=""
                  >
                    ↳ {item.documentPathLabel}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)]">
        ↑↓ 选择 · Enter 插入 · Esc 取消
      </div>
    </div>,
    document.body,
  )
})
