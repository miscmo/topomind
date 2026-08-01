import { useState } from 'react'
import { Book, Settings, GripVertical, FileText } from 'lucide-react'
import { logAction } from '../../../core/log-backend'
import { type KBItem } from '../model/useHomeKnowledgeBases'

interface KnowledgeBaseGridProps {
  kbs: KBItem[]
  onOpenKB: (kb: KBItem) => void
  onOpenSettings: (kb: KBItem) => void
  onReorder?: (newOrder: string[]) => void
}

export function KnowledgeBaseGrid(props: KnowledgeBaseGridProps) {
  const { kbs, onOpenKB, onOpenSettings, onReorder } = props
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  const [reorderAnnouncement, setReorderAnnouncement] = useState('')

  const handleDragStart = (e: React.DragEvent, name: string) => {
    setDraggedItem(name)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, name: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverItem !== name) {
      setDragOverItem(name)
    }
  }

  const handleDrop = (e: React.DragEvent, targetName: string) => {
    e.preventDefault()
    if (!draggedItem || draggedItem === targetName) {
      setDragOverItem(null)
      setDraggedItem(null)
      return
    }

    const newOrder = kbs.map(k => k.name)
    const dragIndex = newOrder.indexOf(draggedItem)
    const dropIndex = newOrder.indexOf(targetName)

    if (dragIndex !== -1 && dropIndex !== -1 && onReorder) {
      newOrder.splice(dragIndex, 1)
      newOrder.splice(dropIndex, 0, draggedItem)
      onReorder(newOrder)
    }

    setDragOverItem(null)
    setDraggedItem(null)
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
    setDragOverItem(null)
  }

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{reorderAnnouncement}</div>
      <div className="grid grid-cols-3 gap-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8" aria-describedby="kb-reorder-hint">
        <span id="kb-reorder-hint" className="sr-only">按 Enter 或空格打开知识库，按左右方向键调整排序。</span>
      {kbs.map((kb) => (
        <div
          key={kb.name}
          draggable
          tabIndex={0}
          role="button"
          aria-label={`打开知识库 ${kb.name}`}
          onDragStart={(e) => handleDragStart(e, kb.name)}
          onDragOver={(e) => handleDragOver(e, kb.name)}
          onDrop={(e) => handleDrop(e, kb.name)}
          onDragEnd={handleDragEnd}
          className={`group relative flex cursor-pointer flex-col rounded-lg border border-border/60 bg-card transition-all duration-200 hover:-translate-y-1 hover:border-border hover:shadow-md overflow-hidden [transform:translateZ(0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
            ${draggedItem === kb.name ? 'opacity-50' : ''}
            ${dragOverItem === kb.name ? 'border-primary ring-2 ring-primary/20' : ''}
          `}
          onClick={() => {
            logAction('HomePage:点击知识库卡片', 'HomePage', { kbInfo: kb })
            onOpenKB(kb)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              logAction('HomePage:键盘打开知识库卡片', 'HomePage', { kbInfo: kb })
              onOpenKB(kb)
              return
            }
            if (!onReorder || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
            event.preventDefault()
            const currentIndex = kbs.findIndex((item) => item.name === kb.name)
            const nextIndex = event.key === 'ArrowLeft' ? Math.max(0, currentIndex - 1) : Math.min(kbs.length - 1, currentIndex + 1)
            if (currentIndex === nextIndex) return
            const nextOrder = kbs.map((item) => item.name)
            nextOrder.splice(currentIndex, 1)
            nextOrder.splice(nextIndex, 0, kb.name)
            setReorderAnnouncement(`${kb.name} 已移动到第 ${nextIndex + 1} 位，共 ${kbs.length} 个知识库。`)
            onReorder(nextOrder)
          }}
        >
          <div className="relative aspect-[1/1] w-full overflow-hidden rounded-t-lg bg-muted">
              {kb.coverUrl ? (
                <div className="relative h-full w-full">
                  <img
                    src={kb.coverUrl}
                    alt={kb.name}
                    onError={(event) => { event.currentTarget.style.display = 'none'; event.currentTarget.parentElement?.querySelector('[data-cover-fallback]')?.classList.remove('hidden') }}
                    className="h-full w-full object-cover transition-transform duration-300 transform-gpu will-change-transform [backface-visibility:hidden] group-hover:scale-105"
                    style={{ objectPosition: `50% ${kb.coverOffset ?? 50}%` }}
                  />
                  <div data-cover-fallback className="absolute inset-0 hidden items-center justify-center bg-gradient-to-br from-muted to-muted/50 text-muted-foreground/40">
                    <Book className="h-7 w-7" strokeWidth={1.5} />
                  </div>
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50 text-muted-foreground/40">
                  <Book className="h-7 w-7" strokeWidth={1.5} />
                </div>
              )}
            <button
              type="button"
              aria-label={`打开 ${kb.name} 的知识库设置`}
              className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-all hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onOpenSettings(kb)
              }}
              title="知识库设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            <div className="absolute left-2 top-2 cursor-grab rounded-md p-1 text-white/70 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100 drop-shadow-md">
               <GripVertical className="h-4 w-4" />
            </div>
          </div>
          
          <div className="flex flex-col p-2.5">
            <h3 className="truncate text-[13px] font-medium text-card-foreground" title={kb.name}>
              {kb.name}
            </h3>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
              <FileText className="h-3 w-3" />
              <span>{kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}</span>
            </div>
          </div>
        </div>
        ))}
      </div>
    </>
  )
}
