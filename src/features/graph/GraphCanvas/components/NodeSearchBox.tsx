import { memo, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Node } from '@xyflow/react'

interface NodeSearchBoxProps {
  nodes: Node[]
  onSelectNode: (node: Node) => void
  onClose: () => void
}

export const NodeSearchBox = memo(function NodeSearchBox({
  nodes,
  onSelectNode,
  onClose
}: NodeSearchBoxProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredNodes = nodes.filter(node => 
    (node.data?.label as string || '').toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filteredNodes.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filteredNodes.length > 0) {
      e.preventDefault()
      onSelectNode(filteredNodes[selectedIndex])
    }
  }

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] w-[320px] bg-[var(--color-surface)] rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[var(--color-border-strong)] flex flex-col overflow-hidden">
      <div className="flex items-center px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索画布中的节点..."
          className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] min-w-0"
        />
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--color-bg-muted)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {query && (
        <div className="max-h-[300px] overflow-y-auto">
          {filteredNodes.length > 0 ? (
            <div className="py-1">
              {filteredNodes.map((node, index) => (
                <div
                  key={node.id}
                  onClick={() => onSelectNode(node)}
                  className={`px-3 py-2 text-[13px] cursor-pointer truncate ${
                    index === selectedIndex
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)]'
                  }`}
                >
                  {node.data?.label as string}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-[13px] text-[var(--color-text-muted)]">
              没有找到匹配的节点
            </div>
          )}
        </div>
      )}
    </div>
  )
})
