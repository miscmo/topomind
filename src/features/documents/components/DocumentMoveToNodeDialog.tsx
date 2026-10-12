import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, FolderInput, CornerDownRight } from 'lucide-react'
import { useGraphStoreApi } from '../../../stores/graphStore'

interface DocumentMoveToNodeDialogProps {
  sourceNodePath: string
  sourceTitle?: string
  /** 把节点 id 解析为文档系统使用的 cardPath（与 DetailPanel 的 nodePath 一致）。 */
  resolveNodePath: (nodeId: string) => string
  onConfirm: (targetCardPath: string) => void
  onClose: () => void
}

/**
 * 跨节点移动文档的目标节点选择器。
 * 列出画布中所有节点（排除源节点，避免同节点移动走错入口），
 * 并额外提供「根节点」选项（当源不是根时）。支持模糊搜索与键盘导航。
 *
 * 注意：传给后端的必须是文档系统的 cardPath（= resolveNodePath(node.id)），
 * 而不是原始 node.id，否则文档会被写到错误的目录、在目标节点中“消失”。
 */
export const DocumentMoveToNodeDialog = memo(function DocumentMoveToNodeDialog({
  sourceNodePath,
  sourceTitle,
  resolveNodePath,
  onConfirm,
  onClose,
}: DocumentMoveToNodeDialogProps) {
  const graphStoreApi = useGraphStoreApi()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const nodes = useMemo(() => {
    const map = graphStoreApi.getState().nodesMap
    const list = Array.from(map.values()).map((node) => ({
      cardPath: resolveNodePath(node.id),
      label: (node.data?.label as string) || node.id,
    }))
    // 排除源节点：同节点移动应走 reparent 入口，不应在此选择。
    // 用 cardPath 比较（源节点传入的 sourceNodePath 就是 cardPath）。
    const filtered = list.filter((n) => n.cardPath !== sourceNodePath)
    // 源不是根时，提供「根节点（工作区顶层）」选项。
    if (sourceNodePath !== '__ROOT__') {
      filtered.unshift({ cardPath: '__ROOT__', label: '根节点（工作区顶层）' })
    }
    return filtered
  }, [graphStoreApi, sourceNodePath, resolveNodePath])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter((n) => n.label.toLowerCase().includes(q))
  }, [nodes, query])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelectedIndex(0) }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = selected ?? (filtered.length > 0 ? filtered[0].cardPath : null)
      if (target) onConfirm(target)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        className="w-[360px] max-w-[92vw] bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">移动到节点</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-1.5 text-[12px] leading-snug text-[var(--color-text-muted)]">
          将「{sourceTitle || '未命名文档'}」及其全部子文档移动到：
        </div>
        <div className="flex items-center px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索节点…"
            className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] min-w-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-text-muted)]">没有匹配的节点</div>
          ) : (
            filtered.map((node, index) => (
              <button
                key={node.cardPath}
                type="button"
                onClick={() => { setSelected(node.cardPath); onConfirm(node.cardPath) }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-left text-[13px] transition-colors ${
                  index === selectedIndex
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)]'
                }`}
              >
                <span className="flex items-center justify-center text-[var(--color-text-muted)]">
                  {node.cardPath === '__ROOT__' ? <FolderInput className="w-4 h-4" /> : <CornerDownRight className="w-4 h-4" />}
                </span>
                <span className="truncate flex-1">{node.label}</span>
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            移动
          </button>
        </div>
      </div>
    </div>
  )
})
