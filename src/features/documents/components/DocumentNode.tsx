import React from 'react'
import type { TopoDocumentManifestItem } from '../../../core/storage'
import { topoDocumentPath, topoDocumentTypeIcon } from '../types/documentTypes'
import { DocumentInlineEdit } from './DocumentInlineEdit'
import type { DocumentInlineEditState } from '../model/useDocumentSidebarModel'

interface DocumentNodeProps {
  node: TopoDocumentManifestItem
  level: number
  activeDocumentPath: string
  childrenMap: Record<string, TopoDocumentManifestItem[]>
  expandedNodes: Set<string>
  inlineEdit: DocumentInlineEditState | null
  inlineInputRef: React.RefObject<HTMLInputElement | null>
  isBusy?: boolean
  draggedId: string | null
  dragState: { id: string, position: 'before' | 'inside' | 'after' } | null
  onSelectDocument: (path: string) => void
  onRenameDocument: (id: string) => void
  onOpenIconPicker: (id: string, x: number, y: number) => void
  onToggleExpand: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string | null) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, id: string | null) => void
  onInlineEditChange: (value: string) => void
  onInlineEditBlur: () => void
  onInlineEditKeyDown: (e: React.KeyboardEvent) => void
}

export const DocumentNode: React.FC<DocumentNodeProps> = ({
  node,
  level,
  activeDocumentPath,
  childrenMap,
  expandedNodes,
  inlineEdit,
  inlineInputRef,
  isBusy,
  draggedId,
  dragState,
  onSelectDocument,
  onRenameDocument,
  onOpenIconPicker,
  onToggleExpand,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onInlineEditChange,
  onInlineEditBlur,
  onInlineEditKeyDown,
}) => {
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
    <React.Fragment>
      {isEditing ? (
        <DocumentInlineEdit
          level={level}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          onChange={onInlineEditChange}
          onBlur={onInlineEditBlur}
          onKeyDown={onInlineEditKeyDown}
        />
      ) : (
        <div
          role="treeitem"
          tabIndex={0}
          aria-level={level + 1}
          aria-selected={isActive}
          aria-expanded={hasChildren ? isExpanded : undefined}
          draggable={!isEditing}
          onDragStart={(e) => onDragStart(e, node.id)}
          onDragOver={(e) => onDragOver(e, node.id)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, node.id)}
          className={`group w-full flex items-center mb-[2px] py-[7px] pr-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[var(--color-hover-bg)] ${isActive ? '!bg-[var(--color-selected-bg)]' : ''} ${dragClass} ${draggedId === node.id ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 4}px` }}
          onClick={() => onSelectDocument(topoDocumentPath(node.id))}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectDocument(topoDocumentPath(node.id))
            }
          }}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('[data-document-title]')) return
            e.preventDefault()
            e.stopPropagation()
            onRenameDocument(node.id)
          }}
          onContextMenu={(e) => onContextMenu(e, node.id)}
          title={node.title}
        >
          <span
            role={hasChildren ? 'button' : undefined}
            tabIndex={hasChildren ? 0 : -1}
            draggable={hasChildren ? false : undefined}
            aria-label={hasChildren ? `${isExpanded ? '折叠' : '展开'}「${node.title}」` : undefined}
            className={`w-5 h-5 flex items-center justify-center shrink-0 ${hasChildren ? 'cursor-pointer hover:bg-black/5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onDragStart={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (hasChildren) onToggleExpand(node.id)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (hasChildren && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                onToggleExpand(node.id)
              }
            }}
          >
            {hasChildren ? (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                <path d="M9 18l6-6-6-6" />
              </svg>
            ) : <span className="w-1" />}
          </span>
          <span className="w-5 h-5 flex items-center justify-center shrink-0 mr-1">
            <span
              role="button"
              tabIndex={isBusy ? -1 : 0}
              draggable={false}
              aria-label={`更换「${node.title}」的图标`}
              aria-disabled={isBusy || undefined}
              className={`w-5 h-5 flex items-center justify-center rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${isBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-black/5'}`}
              onPointerDown={(e) => {
                e.stopPropagation()
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
              onDragStart={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isBusy) return
                const rect = e.currentTarget.getBoundingClientRect()
                onOpenIconPicker(node.id, rect.left, rect.bottom)
              }}
              onKeyDown={(e) => {
                if (!isBusy && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  onOpenIconPicker(node.id, rect.left, rect.bottom)
                }
              }}
            >
              {node.icon || topoDocumentTypeIcon(node.type)}
            </span>
          </span>
          <span
            data-document-title
            className="block text-[12px] font-semibold leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis text-[var(--color-text-primary)]"
            style={node.color ? { color: node.color } : undefined}
          >
            {node.title}
          </span>
        </div>
      )}
      {isExpanded && children.map(child => (
        <DocumentNode
          key={child.id}
          node={child}
          level={level + 1}
          activeDocumentPath={activeDocumentPath}
          childrenMap={childrenMap}
          expandedNodes={expandedNodes}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          draggedId={draggedId}
          dragState={dragState}
          onSelectDocument={onSelectDocument}
          onRenameDocument={onRenameDocument}
          onOpenIconPicker={onOpenIconPicker}
          onToggleExpand={onToggleExpand}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onInlineEditChange={onInlineEditChange}
          onInlineEditBlur={onInlineEditBlur}
          onInlineEditKeyDown={onInlineEditKeyDown}
        />
      ))}
      {isExpanded && inlineEdit?.mode !== 'rename' && inlineEdit?.parentId === node.id && (
        <DocumentInlineEdit
          level={level + 1}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          onChange={onInlineEditChange}
          onBlur={onInlineEditBlur}
          onKeyDown={onInlineEditKeyDown}
        />
      )}
    </React.Fragment>
  )
}
