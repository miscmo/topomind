import React, { useState, useRef, useEffect, useMemo } from 'react'
import type { TopoDocumentManifestItem } from '../../../../core/storage'
import { topoDocumentPath, buildDocumentTree, topoDocumentTypeIcon } from '../../../../features/documents/types/documentTypes'
import type { TopoDocumentType } from '../../../../core/storage'
import { ChevronRight, File, Folder } from 'lucide-react'
import { DocumentContextMenu } from '../../../../features/documents/components/DocumentContextMenu'
import { DocumentMetaPicker, type DocumentMetaPickerState } from '../../../../features/documents/components/DocumentMetaPicker'
import { usePromptStore } from '../../../../shared/ui/PromptModal/promptStore'

interface DocumentBreadcrumbProps {
  topoDocuments: TopoDocumentManifestItem[]
  activeTopoDocumentId: string | null
  onSelectDocument: (documentPath: string) => void
  nodeLabel: string
  onCreateDocument?: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onRenameDocument?: (documentPath: string, name: string) => void
  onDeleteDocument?: (documentPath: string) => void
  onExportDocument?: (documentPath: string) => void
  onUpdateDocumentMeta?: (documentPath: string, patch: { icon?: string | null; color?: string | null }) => void
}

export const DocumentBreadcrumb: React.FC<DocumentBreadcrumbProps> = ({
  topoDocuments,
  activeTopoDocumentId,
  onSelectDocument,
  nodeLabel,
  onCreateDocument,
  onRenameDocument,
  onDeleteDocument,
  onExportDocument,
  onUpdateDocumentMeta
}) => {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const breadcrumbRef = useRef<HTMLDivElement>(null)

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, targetId: string | null } | null>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [metaPicker, setMetaPicker] = useState<DocumentMetaPickerState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close dropdown and context menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return
      }
      setContextMenu(null)

      if (breadcrumbRef.current && !breadcrumbRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null)
      }
    }
    const blockMenu = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        e.preventDefault()
      } else {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('contextmenu', blockMenu)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('contextmenu', blockMenu)
    }
  }, [])

  const { rootItems, childrenMap } = useMemo(() => buildDocumentTree(topoDocuments), [topoDocuments])

  const breadcrumbPath = useMemo(() => {
    if (!activeTopoDocumentId) return []
    
    const path: TopoDocumentManifestItem[] = []
    let currentId: string | null = activeTopoDocumentId
    const documentById = new Map<string, TopoDocumentManifestItem>(topoDocuments.map(d => [d.id, d]))
    
    // To prevent infinite loops in case of circular references
    const visited = new Set<string>()

    while (currentId && documentById.has(currentId)) {
      if (visited.has(currentId)) break
      visited.add(currentId)
      
      const foundDoc: TopoDocumentManifestItem = documentById.get(currentId)!
      path.unshift(foundDoc)
      currentId = foundDoc.parentId
    }

    return path
  }, [topoDocuments, activeTopoDocumentId])

  // Root item represents the base level
  const breadcrumbItems = useMemo(() => {
    return [
      { id: 'root', title: nodeLabel || '根目录', isRoot: true, item: null },
      ...breadcrumbPath.map(item => ({ id: item.id, title: item.title, isRoot: false, item }))
    ]
  }, [breadcrumbPath, nodeLabel])

  const handleSelect = (docId: string) => {
    onSelectDocument(topoDocumentPath(docId))
    setOpenDropdownId(null)
  }

  const handleContextMenu = (e: React.MouseEvent, docId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, targetId: docId })
  }

  const handleContextMenuAction = async (action: string) => {
    if (!contextMenu) return
    const targetId = contextMenu.targetId
    setContextMenu(null)

    if (action === 'rename' && targetId && onRenameDocument) {
      const doc = topoDocuments.find(d => d.id === targetId)
      if (doc) {
        const newName = await usePromptStore.getState().open({
          title: '重命名文档',
          defaultValue: doc.title,
          placeholder: '请输入文档名称'
        })
        if (newName && newName.trim()) {
          onRenameDocument(topoDocumentPath(targetId), newName.trim())
        }
      }
    } else if (action === 'delete' && targetId && onDeleteDocument) {
      onDeleteDocument(topoDocumentPath(targetId))
    } else if (action === 'export' && targetId && onExportDocument) {
      onExportDocument(topoDocumentPath(targetId))
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
    } else if (action.startsWith('create:') && onCreateDocument) {
      const createType = action.slice('create:'.length) as TopoDocumentType
      const newName = await usePromptStore.getState().open({
        title: '新建文档',
        placeholder: '请输入文档名称'
      })
      if (newName && newName.trim()) {
        onCreateDocument(createType, newName.trim(), targetId)
      }
    }
  }

  const renderDropdown = (itemId: string, isRoot: boolean) => {
    if (openDropdownId !== itemId) return null

    const children = isRoot ? rootItems : (childrenMap[itemId] || [])
    
    if (children.length === 0) {
      return (
        <div className="absolute top-full left-0 mt-1 w-48 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg z-50 text-xs text-[var(--color-text-muted)] px-3">
          (空)
        </div>
      )
    }

        return (
          <div className="absolute top-full left-0 mt-1 min-w-[160px] max-w-[240px] max-h-[280px] overflow-y-auto py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md shadow-lg z-50 flex flex-col [scrollbar-width:thin] [scrollbar-color:#94a3b857_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full">
        {children.map(child => {
          const Icon = child.icon || topoDocumentTypeIcon(child.type) || File
          const IconComp = typeof Icon === 'string' ? null : (Icon as React.ComponentType<{ size?: number }>)
          return (
            <button
              key={child.id}
              className={`flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-hover-bg)] w-full shrink-0 truncate ${child.id === activeTopoDocumentId ? 'text-[var(--color-accent)] font-medium bg-[var(--color-accent-soft)]' : 'text-[var(--color-text)]'}`}
              style={child.color && child.id !== activeTopoDocumentId ? { color: child.color } : undefined}
              onClick={(e) => {
                e.stopPropagation()
                handleSelect(child.id)
              }}
              onContextMenu={(e) => handleContextMenu(e, child.id)}
            >
              <div className="w-4 h-4 shrink-0 flex items-center justify-center opacity-70">
                {IconComp ? <IconComp size={14} /> : (typeof Icon === 'string' ? Icon : null)}
              </div>
              <span className="truncate">{child.title || '未命名'}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center text-[12px] text-[var(--color-text-muted)] select-none" ref={breadcrumbRef}>
      {breadcrumbItems.map((item, index) => {
        const isLast = index === breadcrumbItems.length - 1
        const isOpen = openDropdownId === item.id
        
        return (
          <div key={item.id} className="flex items-center relative">
            <button
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[var(--color-hover-bg)] transition-colors max-w-[120px] ${isOpen ? 'bg-[var(--color-hover-bg)] text-[var(--color-text)]' : ''} ${isLast ? 'text-[var(--color-text)]' : ''}`}
              style={!isLast && item.item?.color ? { color: item.item.color } : undefined}
              title={item.isRoot ? '单击展开子文档' : '单击展开子文档，双击进入此文档'}
              onClick={() => setOpenDropdownId(isOpen ? null : item.id)}
              onDoubleClick={(e) => {
                // 双击面包屑项：直接进入（打开）该文档本身
                e.preventDefault()
                if (!item.isRoot) handleSelect(item.id)
              }}
              onContextMenu={(e) => handleContextMenu(e, item.isRoot ? null : item.id)}
            >
              {(() => {
                const childCount = item.isRoot ? rootItems.length : (childrenMap[item.id]?.length ?? 0)
                const Icon = item.isRoot ? Folder : (item.item ? (item.item.icon || topoDocumentTypeIcon(item.item.type) || File) : null)
                if (!Icon) return null
                const IconComp = typeof Icon === 'string' ? null : (Icon as React.ComponentType<{ size?: number }>)
                return (
                  <div
                    className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0"
                    title={childCount > 0 ? `${childCount} 个子文档` : undefined}
                  >
                    <div className="opacity-60 flex items-center justify-center w-full h-full">
                      {IconComp ? <IconComp size={12} /> : (typeof Icon === 'string' ? Icon : null)}
                    </div>
                    {childCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-[var(--color-primary)] text-[var(--color-text-inverse)] text-[9px] font-semibold leading-none ring-1 ring-[var(--color-surface)]">
                        {childCount}
                      </span>
                    )}
                  </div>
                )
              })()}
              <span className="truncate">{item.title}</span>
            </button>
            
            {renderDropdown(item.id, item.isRoot)}
            
            {!isLast && (
              <ChevronRight size={14} className="opacity-40 mx-0.5 shrink-0" />
            )}
          </div>
        )
      })}

      <DocumentContextMenu
        contextMenu={contextMenu}
        activeSubmenu={activeSubmenu}
        menuRef={menuRef}
        isBusy={false}
        onMouseEnterSubmenu={setActiveSubmenu}
        onMouseLeaveSubmenu={() => setActiveSubmenu(null)}
        onAction={(action) => void handleContextMenuAction(action)}
      />

      <DocumentMetaPicker
        picker={metaPicker}
        onClose={() => setMetaPicker(null)}
        onApply={(mode, targetId, value) => {
          setMetaPicker(null)
          if (onUpdateDocumentMeta) {
            onUpdateDocumentMeta(topoDocumentPath(targetId), mode === 'icon' ? { icon: value } : { color: value })
          }
        }}
      />
    </div>
  )
}
