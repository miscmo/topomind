import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FilePlus, Sparkles, Network, Workflow, Download, PenLine, Trash2, ChevronRight } from 'lucide-react'
import type { TopoDocumentManifestItem } from '../../core/storage'
import { topoDocumentPath, topoDocumentTypeIcon, buildDocumentTree } from './documentTypes'

export interface DocumentSidebarProps {
  topoDocuments: TopoDocumentManifestItem[]
  activeDocumentPath: string
  isBusy?: boolean
  onSelectDocument: (documentPath: string) => void
  onCreateTopoSmartDocument: (name: string, parentId?: string | null) => void
  onCreateTopoMindMapDocument: (name: string, parentId?: string | null) => void
  onCreateTopoFlowchartDocument: (name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
}

interface DocumentContextMenuState {
  x: number
  y: number
  targetId: string | null
}

interface DocumentInlineEditState {
  mode: 'createTopoSmart' | 'createTopoMindMap' | 'createTopoFlowchart' | 'rename'
  targetId: string | null
  parentId: string | null
  value: string
}

export function DocumentSidebar({
  topoDocuments,
  activeDocumentPath,
  isBusy,
  onSelectDocument,
  onCreateTopoSmartDocument,
  onCreateTopoMindMapDocument,
  onCreateTopoFlowchartDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
}: DocumentSidebarProps) {
  const { rootItems, childrenMap } = buildDocumentTree(topoDocuments)
  const [contextMenu, setContextMenu] = useState<DocumentContextMenuState | null>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [inlineEdit, setInlineEdit] = useState<DocumentInlineEditState | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<{ id: string, position: 'before' | 'inside' | 'after' } | null>(null)
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const cancelInlineEditOnBlurRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Focus input when inline edit starts
  useEffect(() => {
    if (inlineEdit) {
      setTimeout(() => {
        inlineInputRef.current?.focus()
        inlineInputRef.current?.select()
      }, 0)
    }
  }, [inlineEdit?.mode, inlineEdit?.targetId, inlineEdit?.parentId])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return
      }
      setContextMenu(null)
    }
    const blockMenu = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        e.preventDefault()
      } else {
        setContextMenu(null)
      }
    }
    // 使用 mousedown 和 touchstart 替代 pointerdown 解决系统右键事件冒泡冲突
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    document.addEventListener('contextmenu', blockMenu)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
      document.removeEventListener('contextmenu', blockMenu)
    }
  }, [contextMenu])

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const next = new Set(expandedNodes)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedNodes(next)
  }

  const openContextMenu = (e: React.MouseEvent, targetId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (targetId) {
      onSelectDocument(topoDocumentPath(targetId))
    }
    setActiveSubmenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, targetId })
  }

  const handleContextMenuAction = (action: string) => {
    if (!contextMenu) return
    const targetId = contextMenu.targetId
    setContextMenu(null)

    if (action === 'rename' && targetId) {
      const doc = topoDocuments.find(d => d.id === targetId)
      if (doc) {
        setInlineEdit({ mode: 'rename', targetId, parentId: doc.parentId || null, value: doc.title })
      }
    } else if (action === 'delete' && targetId) {
      onDeleteDocument(topoDocumentPath(targetId))
    } else if (action === 'export' && targetId) {
      onExportTopoDocument(topoDocumentPath(targetId))
    } else if (action.startsWith('create')) {
      const mode = action as DocumentInlineEditState['mode']
      // Force pass the right context menu target as parent ID when creating new documents from context menu
      setInlineEdit({ mode, targetId: null, parentId: targetId || null, value: '' })
      if (targetId) {
        setExpandedNodes(prev => new Set(prev).add(targetId))
      }
    }
  }

  const commitInlineEdit = () => {
    if (!inlineEdit || isBusy) return
    const nextName = inlineEdit.value.trim()
    if (!nextName) {
      setInlineEdit(null)
      return
    }

    if (inlineEdit.mode === 'rename' && inlineEdit.targetId) {
      onRenameDocument(topoDocumentPath(inlineEdit.targetId), nextName)
    } else if (inlineEdit.mode === 'createTopoSmart') {
      onCreateTopoSmartDocument(nextName, inlineEdit.parentId)
    } else if (inlineEdit.mode === 'createTopoMindMap') {
      onCreateTopoMindMapDocument(nextName, inlineEdit.parentId)
    } else if (inlineEdit.mode === 'createTopoFlowchart') {
      onCreateTopoFlowchartDocument(nextName, inlineEdit.parentId)
    }
    
    setInlineEdit(null)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      commitInlineEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      setInlineEdit(null)
    }
  }

  const handleInputBlur = () => {
    if (cancelInlineEditOnBlurRef.current) {
      cancelInlineEditOnBlurRef.current = false
      return
    }
    commitInlineEdit()
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation()
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    // For Firefox to allow drag
    e.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (e: React.DragEvent, id: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedId || draggedId === id) return
    
    if (!id) {
      setDragState({ id: 'root', position: 'inside' })
      return
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    let position: 'before' | 'inside' | 'after' = 'inside'
    
    const doc = topoDocuments.find(d => d.id === id)
    // Don't allow inside if it's fixed or we are at top/bottom 25%
    if (y < rect.height * 0.25) position = 'before'
    else if (y > rect.height * 0.75) position = 'after'
    
    // Check if target is descendant of draggedId
    let current: string | null = id
    while (current) {
      if (current === draggedId) return // Cannot drop into own descendant
      const currentDoc = topoDocuments.find(d => d.id === current)
      current = currentDoc ? currentDoc.parentId : null
    }

    setDragState({ id, position })
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragState(null)
  }

  const handleDrop = (e: React.DragEvent, id: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedId || !dragState) {
      setDragState(null)
      setDraggedId(null)
      return
    }

    const targetId = dragState.id === 'root' ? null : dragState.id
    const position = dragState.position

    if (onMoveDocument) {
      if (position === 'inside') {
        const targetChildren = targetId ? (childrenMap[targetId] || []) : rootItems
        const newSortOrder = targetChildren.length > 0 
          ? Math.max(...targetChildren.map(c => c.sortOrder)) + 1 
          : 0
        onMoveDocument(draggedId, targetId, newSortOrder)
        if (targetId) setExpandedNodes(prev => new Set(prev).add(targetId))
      } else {
        const targetDoc = topoDocuments.find(d => d.id === targetId)
        if (targetDoc) {
          const siblings = (targetDoc.parentId ? childrenMap[targetDoc.parentId] : rootItems) || []
          const targetIndex = siblings.findIndex(s => s.id === targetId)
          let newSortOrder = targetDoc.sortOrder
          if (position === 'before') {
            const prev = targetIndex > 0 ? siblings[targetIndex - 1].sortOrder : targetDoc.sortOrder - 1
            newSortOrder = (prev + targetDoc.sortOrder) / 2
          } else {
            const next = targetIndex < siblings.length - 1 ? siblings[targetIndex + 1].sortOrder : targetDoc.sortOrder + 1
            newSortOrder = (targetDoc.sortOrder + next) / 2
          }
          onMoveDocument(draggedId, targetDoc.parentId, newSortOrder)
        }
      }
    }
    
    setDragState(null)
    setDraggedId(null)
  }

  const renderInlineEdit = (level: number) => {
    if (!inlineEdit) return null
    return (
      <div 
        className="w-full flex items-center justify-between mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[#f5f8fb] py-1 px-2 bg-white/22 cursor-default border border-[var(--color-border-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]"
        style={{ paddingLeft: `${level * 16 + 10}px` }}
      >
        <input
          ref={inlineInputRef}
          className="flex-1 w-full min-h-[calc(1.35em+10px)] py-1 px-2.5 border border-transparent !border-[var(--color-border-light)] rounded-lg bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] text-[#1e293b] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-all duration-75 focus:bg-white/44 focus:!bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[#94a3b847] focus:!border-[var(--color-border)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:!shadow-[0_0_0_2px_var(--color-accent-soft)] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:text-[#94a3b8] placeholder:font-medium placeholder:!text-[var(--color-text-muted)]"
          value={inlineEdit.value}
          placeholder="输入文档名称"
          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={isBusy}
        />
      </div>
    )
  }

  const renderNode = (node: TopoDocumentManifestItem, level: number) => {
    const isEditing = inlineEdit?.mode === 'rename' && inlineEdit.targetId === node.id
    const children = childrenMap[node.id] || []
    const isExpanded = expandedNodes.has(node.id)
    const hasChildren = children.length > 0
    const isActive = topoDocumentPath(node.id) === activeDocumentPath
    const isDragTarget = dragState?.id === node.id
    const dragClass = isDragTarget 
      ? dragState.position === 'before' ? 'border-t-[1.5px] border-t-[var(--color-primary)]' 
      : dragState.position === 'after' ? 'border-b-[1.5px] border-b-[var(--color-primary)]'
      : 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-primary)]'
      : ''

    return (
      <React.Fragment key={node.id}>
        {isEditing ? renderInlineEdit(level) : (
          <button
            type="button"
            draggable={!isEditing}
            onDragStart={(e) => handleDragStart(e, node.id)}
            onDragOver={(e) => handleDragOver(e, node.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.id)}
            className={`group w-full flex items-center mb-[2px] py-[7px] pr-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[var(--color-hover-bg)] ${isActive ? '!bg-[var(--color-selected-bg)]' : ''} ${dragClass} ${draggedId === node.id ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => onSelectDocument(topoDocumentPath(node.id))}
            onContextMenu={(e) => openContextMenu(e, node.id)}
            title={node.title}
          >
            <span 
              className={`w-5 h-5 flex items-center justify-center shrink-0 ${hasChildren ? 'hover:bg-black/5 rounded' : ''}`}
              onClick={(e) => hasChildren ? toggleExpand(e, node.id) : undefined}
            >
              {hasChildren ? (
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              ) : <span className="w-1" />}
            </span>
            <span className="w-5 h-5 flex items-center justify-center shrink-0 text-sm mr-1">
              {topoDocumentTypeIcon(node.type)}
            </span>
            <span className={`block text-[12px] font-semibold leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis text-[var(--color-text-primary)]`}>
              {node.title}
            </span>
          </button>
        )}
        {isExpanded && children.map(child => renderNode(child, level + 1))}
        {isExpanded && inlineEdit?.mode !== 'rename' && inlineEdit?.parentId === node.id && renderInlineEdit(level + 1)}
      </React.Fragment>
    )
  }

  const adjustedX = contextMenu ? Math.max(0, Math.min(contextMenu.x, window.innerWidth - 180)) : 0
  const adjustedY = contextMenu ? Math.max(0, Math.min(contextMenu.y, window.innerHeight - 200)) : 0

  return (
    <div 
      className="flex-1 min-h-0 flex flex-col relative"
      onContextMenu={(e) => openContextMenu(e, null)}
      onDragOver={(e) => handleDragOver(e, null)}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className={`flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full ${dragState?.id === 'root' ? 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-primary)]' : ''}`}>
        {inlineEdit?.mode !== 'rename' && !inlineEdit?.parentId && renderInlineEdit(0)}
        {rootItems.map(node => renderNode(node, 0))}
        {rootItems.length === 0 && !inlineEdit && (
          <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无文档</div>
        )}
      </div>

      {contextMenu && createPortal(
        <div
          ref={menuRef}
          id="document-context-menu"
          className="fixed min-w-[180px] p-1.5 bg-white/90 dark:bg-[#1b2330]/90 border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[1200] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
          style={{ left: adjustedX, top: adjustedY, transformOrigin: 'top left' }}
        >
          <div 
            className="relative"
            onMouseEnter={() => setActiveSubmenu('create')}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <button
              type="button"
              className={`flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none text-[var(--color-text-primary)] ${activeSubmenu === 'create' ? 'bg-[var(--color-hover-bg)]' : 'bg-transparent'}`}
            >
              <span className="flex items-center justify-center text-[var(--color-text-muted)]">
                <FilePlus className="w-4 h-4" />
              </span>
              <span className="flex-1">新建文档</span>
              <span className="flex items-center justify-center text-[var(--color-text-muted)]">
                <ChevronRight className="w-4 h-4" />
              </span>
            </button>
            {activeSubmenu === 'create' && (
              <div className="absolute left-[calc(100%-4px)] top-[-6px] min-w-[160px] p-1.5 bg-white/90 dark:bg-[#1b2330]/90 border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[1200] backdrop-blur-xl animate-in fade-in slide-in-from-left-1 duration-100">
                <button
                  type="button"
                  className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleContextMenuAction('createTopoSmart')}
                  disabled={isBusy}
                >
                  <span className="flex items-center justify-center text-[var(--color-text-muted)]"><Sparkles className="w-4 h-4" /></span>
                  智能文档
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleContextMenuAction('createTopoMindMap')}
                  disabled={isBusy}
                >
                  <span className="flex items-center justify-center text-[var(--color-text-muted)]"><Network className="w-4 h-4" /></span>
                  思维导图
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleContextMenuAction('createTopoFlowchart')}
                  disabled={isBusy}
                >
                  <span className="flex items-center justify-center text-[var(--color-text-muted)]"><Workflow className="w-4 h-4" /></span>
                  流程图
                </button>
              </div>
            )}
          </div>
          {contextMenu.targetId && <div className="h-px bg-[var(--color-border-subtle)] mx-1 my-1" />}
          {contextMenu.targetId && (
            <button
              type="button"
              className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleContextMenuAction('export')}
              disabled={isBusy}
            >
              <span className="flex items-center justify-center text-[var(--color-text-muted)]"><Download className="w-4 h-4" /></span>
              导出
            </button>
          )}
          {contextMenu.targetId && (
            <button
              type="button"
              className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleContextMenuAction('rename')}
              disabled={isBusy}
            >
              <span className="flex items-center justify-center text-[var(--color-text-muted)]"><PenLine className="w-4 h-4" /></span>
              重命名
            </button>
          )}
          {contextMenu.targetId && (
            <button
              type="button"
              className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] disabled:opacity-40 disabled:cursor-not-allowed group"
              onClick={() => handleContextMenuAction('delete')}
              disabled={isBusy}
            >
              <span className="flex items-center justify-center text-[var(--color-danger)] group-hover:text-[var(--color-danger-hover)]"><Trash2 className="w-4 h-4" /></span>
              删除
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
