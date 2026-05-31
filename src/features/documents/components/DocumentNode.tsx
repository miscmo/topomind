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
  onToggleExpand: (e: React.MouseEvent, id: string) => void
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
        <button
          type="button"
          draggable={!isEditing}
          onDragStart={(e) => onDragStart(e, node.id)}
          onDragOver={(e) => onDragOver(e, node.id)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, node.id)}
          className={`group w-full flex items-center mb-[2px] py-[7px] pr-2.5 border-none rounded-lg bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[var(--color-hover-bg)] ${isActive ? '!bg-[var(--color-selected-bg)]' : ''} ${dragClass} ${draggedId === node.id ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 4}px` }}
          onClick={() => onSelectDocument(topoDocumentPath(node.id))}
          onDoubleClick={(e) => {
            if (hasChildren) {
              onToggleExpand(e, node.id)
            }
          }}
          onContextMenu={(e) => onContextMenu(e, node.id)}
          title={node.title}
        >
          <span 
            className={`w-5 h-5 flex items-center justify-center shrink-0 ${hasChildren ? 'hover:bg-black/5 rounded' : ''}`}
            onClick={(e) => hasChildren ? onToggleExpand(e, node.id) : undefined}
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
