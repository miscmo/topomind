import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'
import { topoDocumentIdFromPath, topoDocumentPath, buildDocumentTree } from '../types/documentTypes'
import { TOPO_DOCUMENT_TYPES } from '../services/documentTypeRegistry'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { useConfirmStore } from '../../../shared/ui/ConfirmModal/confirmStore'
import type { DocumentMetaPickerState } from '../components/DocumentMetaPicker'
import {
  flattenVisibleDocumentTree,
  resolveStickyDocumentAncestorIds,
  type DocumentTreeRowLayout,
} from './documentStickyAncestors'
import {
  loadDocumentSidebarScrollTop,
  loadExpandedDocumentNodeIds,
  saveDocumentSidebarScrollTop,
  saveExpandedDocumentNodeIds,
} from './documentSidebarState'

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
  topoDocuments: TopoDocumentManifestItem[]
  isBusy?: boolean
  onSelectDocument: (documentPath: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
  onUpdateDocumentMeta?: (documentPath: string, patch: { icon?: string | null; color?: string | null }) => void
}

export function useDocumentSidebarModel({
  nodeId,
  topoDocuments,
  isBusy,
  onSelectDocument,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
  onUpdateDocumentMeta,
}: UseDocumentSidebarModelProps) {
  const graphStoreApi = useGraphStoreApi()
  const { rootItems, childrenMap } = useMemo(() => buildDocumentTree(topoDocuments), [topoDocuments])
  const [contextMenu, setContextMenu] = useState<DocumentContextMenuState | null>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [inlineEdit, setInlineEdit] = useState<DocumentInlineEditState | null>(null)
  const [metaPicker, setMetaPicker] = useState<DocumentMetaPickerState | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => (
    loadExpandedDocumentNodeIds(localStorage, nodeId)
  ))
  const visibleTreeRows = useMemo(
    () => flattenVisibleDocumentTree(rootItems, childrenMap, expandedNodes),
    [childrenMap, expandedNodes, rootItems],
  )
  const visibleTreeRowById = useMemo(
    () => new Map(visibleTreeRows.map((row) => [row.node.id, row])),
    [visibleTreeRows],
  )
  const [stickyAncestorIds, setStickyAncestorIds] = useState<string[]>([])
  const stickyAncestorRows = useMemo(
    () => stickyAncestorIds.flatMap((id) => {
      const row = visibleTreeRowById.get(id)
      return row ? [row] : []
    }),
    [stickyAncestorIds, visibleTreeRowById],
  )
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<{ id: string, position: 'before' | 'inside' | 'after' } | null>(null)
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const cancelInlineEditOnBlurRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>())
  const rowLayoutsRef = useRef<DocumentTreeRowLayout[]>([])
  const rowLayoutByIdRef = useRef(new Map<string, DocumentTreeRowLayout>())
  const stickySyncFrameRef = useRef<number | null>(null)
  const scrollPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollTopRef = useRef(loadDocumentSidebarScrollTop(localStorage, nodeId))
  // 文档列表滚动进度条（自动显隐）：度量 + 显隐状态
  const [scrollMetrics, setScrollMetrics] = useState<{ trackHeight: number; thumbHeight: number; thumbTop: number } | null>(null)
  const [scrollbarActive, setScrollbarActive] = useState(false)
  const scrollbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const registerDocumentRow = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) rowElementsRef.current.set(id, element)
    else rowElementsRef.current.delete(id)
  }, [])

  const syncStickyAncestors = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nextIds = resolveStickyDocumentAncestorIds(
      rowLayoutsRef.current,
      container.scrollTop,
      rowLayoutByIdRef.current,
    )
    setStickyAncestorIds((previous) => (
      previous.length === nextIds.length && previous.every((id, index) => id === nextIds[index])
        ? previous
        : nextIds
    ))
  }, [])

  const scheduleStickyAncestorSync = useCallback(() => {
    if (stickySyncFrameRef.current !== null) return
    stickySyncFrameRef.current = requestAnimationFrame(() => {
      stickySyncFrameRef.current = null
      syncStickyAncestors()
    })
  }, [syncStickyAncestors])

  // 计算文档列表滚动进度条度量（thumb 高度/位置）；无溢出则清空
  const updateScrollMetrics = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const { scrollTop, clientHeight, scrollHeight } = container
    if (scrollHeight <= clientHeight) {
      setScrollMetrics(null)
      return
    }
    const trackHeight = clientHeight
    const thumbHeight = Math.max(24, (clientHeight * clientHeight) / scrollHeight)
    const maxScroll = scrollHeight - clientHeight
    const thumbTop = maxScroll > 0
      ? (scrollTop / maxScroll) * (trackHeight - thumbHeight)
      : 0
    setScrollMetrics({ trackHeight, thumbHeight, thumbTop })
  }, [])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const measuredLayouts = visibleTreeRows.flatMap((row) => {
      const element = rowElementsRef.current.get(row.node.id)
      if (!element) return []
      const rect = element.getBoundingClientRect()
      const top = container.scrollTop + rect.top - containerRect.top
      return [{
        row,
        top,
        bottom: top + rect.height,
      }]
    })
    const layouts = measuredLayouts.map((layout, index) => ({
      ...layout,
      stackHeight: Math.max(
        0,
        measuredLayouts[index + 1]?.top - layout.top || layout.bottom - layout.top,
      ),
    }))
    rowLayoutsRef.current = layouts
    rowLayoutByIdRef.current = new Map(layouts.map((layout) => [layout.row.node.id, layout]))
    syncStickyAncestors()
    updateScrollMetrics()
  }, [inlineEdit, syncStickyAncestors, updateScrollMetrics, visibleTreeRows])

  useEffect(() => () => {
    if (stickySyncFrameRef.current !== null) cancelAnimationFrame(stickySyncFrameRef.current)
    if (scrollPersistTimerRef.current !== null) clearTimeout(scrollPersistTimerRef.current)
    if (scrollbarHideTimerRef.current !== null) clearTimeout(scrollbarHideTimerRef.current)
  }, [])

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    if (inlineEdit) {
      focusTimer = setTimeout(() => {
        const input = inlineInputRef.current
        input?.scrollIntoView({ block: 'nearest' })
        input?.focus()
        input?.select()
      }, 0)
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer)
    }
  }, [inlineEdit?.mode, inlineEdit?.targetId, inlineEdit?.parentId])

  useEffect(() => {
    setExpandedNodes(loadExpandedDocumentNodeIds(localStorage, nodeId))
    setStickyAncestorIds([])
    rowElementsRef.current.clear()
    rowLayoutsRef.current = []
    rowLayoutByIdRef.current.clear()
  }, [nodeId])

  const updateExpandedNodes = useCallback((updater: (previous: Set<string>) => Set<string>) => {
    setExpandedNodes((previous) => {
      const next = updater(previous)
      saveExpandedDocumentNodeIds(localStorage, nodeId, next)
      return next
    })
  }, [nodeId])

  useEffect(() => {
    if (!nodeId || rootItems.length === 0) return
    const savedScrollTop = loadDocumentSidebarScrollTop(localStorage, nodeId)
    lastScrollTopRef.current = savedScrollTop
    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) {
        container.scrollTop = savedScrollTop
        syncStickyAncestors()
        updateScrollMetrics()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [nodeId, rootItems.length, syncStickyAncestors])

  const handleSidebarScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop
    lastScrollTopRef.current = scrollTop
    scheduleStickyAncestorSync()

    if (scrollPersistTimerRef.current !== null) clearTimeout(scrollPersistTimerRef.current)
    scrollPersistTimerRef.current = setTimeout(() => {
      scrollPersistTimerRef.current = null
      saveDocumentSidebarScrollTop(localStorage, nodeId, lastScrollTopRef.current)
    }, 180)

    // 进度条：有滚动即显示，停手后逐渐隐藏
    updateScrollMetrics()
    setScrollbarActive(true)
    if (scrollbarHideTimerRef.current !== null) clearTimeout(scrollbarHideTimerRef.current)
    scrollbarHideTimerRef.current = setTimeout(() => {
      scrollbarHideTimerRef.current = null
      setScrollbarActive(false)
    }, 900)
  }, [nodeId, scheduleStickyAncestorSync, updateScrollMetrics])

  useEffect(() => {
    const onResize = () => updateScrollMetrics()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateScrollMetrics])

  useEffect(() => () => {
    saveDocumentSidebarScrollTop(localStorage, nodeId, lastScrollTopRef.current)
  }, [nodeId])

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

  const toggleExpand = useCallback((id: string) => {
    setStickyAncestorIds([])
    updateExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [updateExpandedNodes])

  const selectStickyAncestor = useCallback((documentPath: string) => {
    const id = topoDocumentIdFromPath(documentPath)
    onSelectDocument(documentPath)
    if (!id) return
    const container = scrollContainerRef.current
    const element = rowElementsRef.current.get(id)
    if (!container || !element) return
    container.scrollTo({ top: Math.max(0, element.offsetTop - 8), behavior: 'smooth' })
  }, [onSelectDocument])

  const openContextMenu = useCallback((e: React.MouseEvent, targetId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveSubmenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, targetId })
  }, [])

  const startRename = useCallback((targetId: string) => {
    if (isBusy) return
    const doc = topoDocuments.find(d => d.id === targetId)
    if (!doc) return
    setContextMenu(null)
    setMetaPicker(null)
    setInlineEdit({ mode: 'rename', targetId, parentId: doc.parentId || null, value: doc.title })
  }, [isBusy, topoDocuments])

  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return
    const targetId = contextMenu.targetId
    setContextMenu(null)

    if (action === 'rename' && targetId) {
      startRename(targetId)
    } else if ((action === 'change-icon' || action === 'change-color') && targetId) {
      const doc = topoDocuments.find(d => d.id === targetId)
      if (doc) {
        setMetaPicker({
          mode: action === 'change-icon' ? 'icon' : 'color',
          x: contextMenu.x,
          y: contextMenu.y,
          targetId,
          currentIcon: doc.icon,
          currentColor: doc.color,
        })
      }
    } else if (action === 'delete' && targetId) {
      onDeleteDocument(topoDocumentPath(targetId))
    } else if (action === 'export' && targetId) {
      onExportTopoDocument(topoDocumentPath(targetId))
    } else if (action.startsWith('create:')) {
      const createType = action.slice('create:'.length) as TopoDocumentType
      if (!TOPO_DOCUMENT_TYPES.includes(createType)) return
      
      let initialValue = ''
      if (topoDocuments.length === 0 && nodeId) {
        const node = graphStoreApi.getState().nodesMap.get(nodeId)
        if (node?.data?.label) {
          initialValue = node.data.label
        }
      }

      setInlineEdit({ mode: 'createTopoDocument', createType, targetId: null, parentId: targetId || null, value: initialValue })
      if (targetId) {
        updateExpandedNodes(prev => new Set(prev).add(targetId))
      }
    }
  }, [contextMenu, topoDocuments, onDeleteDocument, onExportTopoDocument, nodeId, startRename, updateExpandedNodes])

  const openIconPicker = useCallback((targetId: string, x: number, y: number) => {
    if (isBusy || !onUpdateDocumentMeta) return
    const doc = topoDocuments.find(d => d.id === targetId)
    if (!doc) return
    setContextMenu(null)
    setMetaPicker({
      mode: 'icon',
      x,
      y,
      targetId,
      currentIcon: doc.icon,
      currentColor: doc.color,
    })
  }, [isBusy, onUpdateDocumentMeta, topoDocuments])

  const handleApplyMeta = useCallback((mode: 'icon' | 'color', targetId: string, value: string | null) => {
    if (!onUpdateDocumentMeta) return
    setMetaPicker(null)
    const doc = topoDocuments.find(d => d.id === targetId)
    if (!doc) return
    onUpdateDocumentMeta(topoDocumentPath(targetId), mode === 'icon'
      ? { icon: value }
      : { color: value })
  }, [onUpdateDocumentMeta, topoDocuments])

  const inlineEditRef = useRef(inlineEdit)
  inlineEditRef.current = inlineEdit

  const commitInlineEdit = useCallback(async () => {
    const currentInlineEdit = inlineEditRef.current
    if (!currentInlineEdit || isBusy) {
      cancelInlineEditOnBlurRef.current = false
      return
    }
    const nextName = currentInlineEdit.value.trim()
    if (!nextName) {
      cancelInlineEditOnBlurRef.current = false
      setInlineEdit(null)
      return
    }

    // Check for duplicates
    const hasDuplicate = topoDocuments.some(d => d.id !== currentInlineEdit.targetId && d.title.trim() === nextName)
    if (hasDuplicate) {
      const confirm = useConfirmStore.getState().open
      const confirmed = await confirm({
        title: '同名节点确认',
        message: `当前目录下已存在名为「${nextName}」的节点，是否继续创建/重命名为该名称？`,
        confirmText: '继续创建/重命名',
        extraButtonText: '查看已存在节点',
        onExtraAction: () => {
          const duplicateDoc = topoDocuments.find(d => d.id !== currentInlineEdit.targetId && d.title.trim() === nextName)
          if (duplicateDoc) {
            onSelectDocument(topoDocumentPath(duplicateDoc.id))
          }
        }
      })
      if (!confirmed) {
        cancelInlineEditOnBlurRef.current = false
        setInlineEdit(null)
        return
      }
    }

    if (currentInlineEdit.mode === 'rename' && currentInlineEdit.targetId) {
      onRenameDocument(topoDocumentPath(currentInlineEdit.targetId), nextName)
    } else if (currentInlineEdit.mode === 'createTopoDocument' && currentInlineEdit.createType) {
      onCreateTopoDocument(currentInlineEdit.createType, nextName, currentInlineEdit.parentId)
    }

    cancelInlineEditOnBlurRef.current = false
    setInlineEdit(null)
  }, [isBusy, onRenameDocument, onCreateTopoDocument, topoDocuments, onSelectDocument])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      cancelInlineEditOnBlurRef.current = true
      void commitInlineEdit()
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
    void commitInlineEdit()
  }, [commitInlineEdit])

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.stopPropagation()
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string | null) => {
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
    
    if (y < rect.height * 0.25) position = 'before'
    else if (y > rect.height * 0.75) position = 'after'
    
    let current: string | null = id
    while (current) {
      if (current === draggedId) return
      const currentDoc = topoDocuments.find(d => d.id === current)
      current = currentDoc ? currentDoc.parentId : null
    }

    setDragState({ id, position })
  }, [draggedId, topoDocuments])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragState(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, _id: string | null) => {
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
        if (targetId) updateExpandedNodes(prev => new Set(prev).add(targetId))
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
  }, [draggedId, dragState, onMoveDocument, childrenMap, rootItems, topoDocuments, updateExpandedNodes])

  return {
    state: {
      rootItems,
      childrenMap,
      contextMenu,
      activeSubmenu,
      inlineEdit,
      metaPicker,
      expandedNodes,
      stickyAncestorRows,
      draggedId,
      dragState,
      scrollMetrics,
      scrollbarActive,
    },
    refs: {
      inlineInputRef,
      menuRef,
      scrollContainerRef,
    },
    actions: {
      setInlineEdit,
      setActiveSubmenu,
      setMetaPicker,
      toggleExpand,
      selectStickyAncestor,
      registerDocumentRow,
      startRename,
      openContextMenu,
      openIconPicker,
      handleContextMenuAction,
      handleApplyMeta,
      handleInputKeyDown,
      handleInputBlur,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleSidebarScroll,
    }
  }
}
