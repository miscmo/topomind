import { useState } from 'react'
import { Book, Settings, Plus, Download, GripVertical, FileText } from 'lucide-react'
import { logAction } from '../../core/log-backend'
import type { KBItem } from './useHomeKnowledgeBases'

interface KnowledgeBaseGridProps {
  kbs: KBItem[]
  onOpenKB: (kb: KBItem) => void
  onCreateKB: () => void
  onImportKB: () => void
  onOpenSettings: (kb: KBItem) => void
  onReorder?: (newOrder: string[]) => void
}

export function KnowledgeBaseGrid(props: KnowledgeBaseGridProps) {
  const { kbs, onOpenKB, onCreateKB, onImportKB, onOpenSettings, onReorder } = props
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)

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
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {kbs.map((kb) => (
        <div
          key={kb.name}
          draggable
          onDragStart={(e) => handleDragStart(e, kb.name)}
          onDragOver={(e) => handleDragOver(e, kb.name)}
          onDrop={(e) => handleDrop(e, kb.name)}
          onDragEnd={handleDragEnd}
          className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:-translate-y-1 hover:border-accent hover:shadow-lg
            ${draggedItem === kb.name ? 'opacity-50' : ''}
            ${dragOverItem === kb.name ? 'border-primary ring-2 ring-primary/20' : ''}
          `}
          onClick={() => {
            logAction('HomePage:点击知识库卡片', 'HomePage', { kbInfo: kb })
            onOpenKB(kb)
          }}
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
            {kb.coverUrl ? (
              <img src={kb.coverUrl} alt={kb.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/30">
                <Book className="h-12 w-12" strokeWidth={1.5} />
              </div>
            )}
            <button
              className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-all hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
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
          
          <div className="flex flex-col p-3">
            <h3 className="truncate font-medium text-card-foreground" title={kb.name}>
              {kb.name}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>{kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}</span>
            </div>
          </div>
        </div>
      ))}

      {/* 新建知识库卡片 */}
      <div 
        className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-transparent transition-all duration-200 hover:border-accent hover:bg-accent/5 aspect-[4/3]"
        onClick={onCreateKB}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
          <Plus className="h-5 w-5" />
        </div>
        <span className="mt-3 text-sm font-medium text-muted-foreground group-hover:text-accent">新建知识库</span>
      </div>

      {/* 导入知识库卡片 */}
      <div 
        className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-transparent transition-all duration-200 hover:border-accent hover:bg-accent/5 aspect-[4/3]"
        onClick={onImportKB}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
          <Download className="h-5 w-5" />
        </div>
        <span className="mt-3 text-sm font-medium text-muted-foreground group-hover:text-accent">导入知识库</span>
      </div>
    </div>
  )
}
