import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'
import { topoDocumentKey, buildDocumentTree } from '../types/documentTypes'
import { TOPO_DOCUMENT_TYPES } from '../services/documentTypeRegistry'

export interface DocumentContextMenuState {
  x: number
  y: number
  targetId: string | null
}

export interface DocumentInlineEditState {
  mode: 'createTopoDocument' | 'rename'
  createType?: TopoDocumentType
  targetId: string | null
  parentId: string | null
  value: string
}

export interface UseDocumentSidebarModelProps {
  nodeId?: string
  readOnly?: boolean
  topoDocuments: TopoDocumentManifestItem[]
  isBusy?: boolean
  onSelectDocument: (documentKey: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentKey: string) => void
  onRenameDocument: (documentKey: string, name: string) => void
  onDeleteDocument: (documentKey: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
}

export function useDocumentSidebarModel({
  nodeId,
  readOnly = false,
  topoDocuments,
  isBusy,
  onSelectDocument,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
}: UseDocumentSidebarModelProps) {
  const { rootItems, childrenMap } = useMemo(() => buildDocumentTree(topoDocuments), [topoDocuments])
  const [contextMenu, setContextMenu] = useState<DocumentContextMenuState | null>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [inlineEdit, setInlineEdit] = useState<DocumentInlineEditState | null>(null)
  const [viewMode, setViewMode] = useState<'active' | 'trash'>('active')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    if (!nodeId) return new Set()
    try {
      const saved = localStorage.getItem(`topomind_expanded_nodes_${nodeId}`)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch (e) {
      return new Set()
    }
  })
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<{ id: string, position: 'before' | 'inside' | 'after' } | null>(null)
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const cancelInlineEditOnBlurRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inlineEdit) {
      setTimeout(() => {
        inlineInputRef.current?.focus()
        inlineInputRef.current?.select()
      }, 0)
    }
  }, [inlineEdit?.mode, inlineEdit?.targetId, inlineEdit?.parentId])

  useEffect(() => {
    if (!nodeId) return
    try {
      const saved = localStorage.getItem(`topomind_expanded_nodes_${nodeId}`)
      setExpandedNodes(saved ? new Set(JSON.parse(saved)) : new Set())
    } catch (e) {
      setExpandedNodes(new Set())
    }
  }, [nodeId])

  useEffect(() => {
    if (!nodeId) return
    localStorage.setItem(`topomind_expanded_nodes_${nodeId}`, JSON.stringify(Array.from(expandedNodes)))
  }, [expandedNodes, nodeId])

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
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    document.addEventListener('contextmenu', blockMenu)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
      document.removeEventListener('contextmenu', blockMenu)
    }
  }, [contextMenu])

  const toggleExpand = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openContextMenu = useCallback((e: React.MouseEvent, targetId: string | null) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    if (targetId) {
      onSelectDocument(topoDocumentKey(targetId))
    }
    setActiveSubmenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, targetId })
  }, [onSelectDocument, readOnly])

  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return
    const targetId = contextMenu.targetId
    setContextMenu(null)

    if (action === 'rename' && targetId) {
      const doc = topoDocuments.find(d => d.id === targetId)
      if (doc) {
        setInlineEdit({ mode: 'rename', targetId, parentId: doc.parentId || null, value: doc.title })
      }
    } else if (action === 'delete' && targetId) {
      onDeleteDocument(topoDocumentKey(targetId))
    } else if (action === 'export' && targetId) {
      onExportTopoDocument(topoDocumentKey(targetId))
    } else if (action.startsWith('create:')) {
      const createType = action.slice('create:'.length) as TopoDocumentType
      if (!TOPO_DOCUMENT_TYPES.includes(createType)) return
      setInlineEdit({ mode: 'createTopoDocument', createType, targetId: null, parentId: targetId || null, value: '' })
      if (targetId) {
        setExpandedNodes(prev => new Set(prev).add(targetId))
      }
    }
  }, [contextMenu, topoDocuments, onDeleteDocument, onExportTopoDocument])

  const commitInlineEdit = useCallback(() => {
    if (!inlineEdit || isBusy) return
    const nextName = inlineEdit.value.trim()
    if (!nextName) {
      setInlineEdit(null)
      return
    }

    if (inlineEdit.mode === 'rename' && inlineEdit.targetId) {
      onRenameDocument(topoDocumentKey(inlineEdit.targetId), nextName)
    } else if (inlineEdit.mode === 'createTopoDocument' && inlineEdit.createType) {
      onCreateTopoDocument(inlineEdit.createType, nextName, inlineEdit.parentId)
    }
    
    setInlineEdit(null)
  }, [inlineEdit, isBusy, onRenameDocument, onCreateTopoDocument])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      commitInlineEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      setInlineEdit(null)
    }
  }, [commitInlineEdit])

  const handleInputBlur = useCallback(() => {
    if (cancelInlineEditOnBlurRef.current) {
      cancelInlineEditOnBlurRef.current = false
      return
    }
    commitInlineEdit()
  }, [commitInlineEdit])

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (readOnly) return
    e.stopPropagation()
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }, [readOnly])

  const handleDragOver = useCallback((e: React.DragEvent, id: string | null) => {
    if (readOnly) return
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
    if (y < rect.height * 0.25) position = 'before'
    else if (y > rect.height * 0.75) position = 'after'
    
    let current: string | null = id
    while (current) {
      if (current === draggedId) return
      const currentDoc = topoDocuments.find(d => d.id === current)
      current = currentDoc ? currentDoc.parentId : null
    }

    setDragState({ id, position })
  }, [draggedId, readOnly, topoDocuments])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    setDragState(null)
  }, [readOnly])

  const handleDrop = useCallback((e: React.DragEvent, id: string | null) => {
    if (readOnly) return
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
        const newSortOrder = targetChildren.length
        onMoveDocument(draggedId, targetId, newSortOrder)
        if (targetId) setExpandedNodes(prev => new Set(prev).add(targetId))
      } else {
        const targetDoc = topoDocuments.find(d => d.id === targetId)
        if (targetDoc) {
          const siblings = ((targetDoc.parentId ? childrenMap[targetDoc.parentId] : rootItems) || [])
            .filter(s => s.id !== draggedId)
          const targetIndex = siblings.findIndex(s => s.id === targetId)
          const newSortOrder = position === 'before' ? Math.max(targetIndex, 0) : Math.max(targetIndex + 1, 0)
          onMoveDocument(draggedId, targetDoc.parentId, newSortOrder)
        }
      }
    }
    
    setDragState(null)
    setDraggedId(null)
  }, [draggedId, dragState, onMoveDocument, childrenMap, readOnly, rootItems, topoDocuments])

  return {
    state: {
      rootItems,
      childrenMap,
      contextMenu,
      activeSubmenu,
      inlineEdit,
      viewMode,
      expandedNodes,
      draggedId,
      dragState,
    },
    refs: {
      inlineInputRef,
      menuRef,
    },
    actions: {
      setViewMode,
      setInlineEdit,
      setActiveSubmenu,
      toggleExpand,
      openContextMenu,
      handleContextMenuAction,
      handleInputKeyDown,
      handleInputBlur,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
    }
  }
}
