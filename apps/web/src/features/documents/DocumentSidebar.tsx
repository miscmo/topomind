import React from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import type { TrashTopoDocumentItem } from '../../core/storage'
import { useDocumentSidebarModel } from './model/useDocumentSidebarModel'
import { DocumentNode } from './components/DocumentNode'
import { DocumentInlineEdit } from './components/DocumentInlineEdit'
import { DocumentContextMenu } from './components/DocumentContextMenu'
import { DocumentTrashItem } from './components/DocumentTrashItem'

export interface DocumentSidebarProps {
  nodeId?: string
  readOnly?: boolean
  topoDocuments: TopoDocumentManifestItem[]
  trashTopoDocuments?: TrashTopoDocumentItem[]
  activeDocumentKey: string
  isBusy?: boolean
  onSelectDocument: (documentKey: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentKey: string) => void
  onRenameDocument: (documentKey: string, name: string) => void
  onDeleteDocument: (documentKey: string) => void
  onRestoreDocument?: (trashName: string) => Promise<void> | void
  onClearTrashDocuments?: () => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
}

export function DocumentSidebar({
  nodeId,
  readOnly = false,
  topoDocuments,
  trashTopoDocuments = [],
  activeDocumentKey,
  isBusy,
  onSelectDocument,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onRestoreDocument,
  onClearTrashDocuments,
  onMoveDocument,
}: DocumentSidebarProps) {
  const { state, refs, actions } = useDocumentSidebarModel({
    nodeId,
    readOnly,
    topoDocuments,
    isBusy,
    onSelectDocument,
    onCreateTopoDocument,
    onExportTopoDocument,
    onRenameDocument,
    onDeleteDocument,
    onMoveDocument,
  })

  const {
    rootItems,
    childrenMap,
    contextMenu,
    activeSubmenu,
    inlineEdit,
    viewMode,
    expandedNodes,
    draggedId,
    dragState,
  } = state

  const { inlineInputRef, menuRef } = refs

  const {
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
  } = actions

  const shownTrash = viewMode === 'trash'

  const handleRestoreTrashDocument = async (trashName: string) => {
    if (!onRestoreDocument) return
    await onRestoreDocument(trashName)
    setViewMode('active')
  }

  return (
    <div 
      className="flex-1 min-h-0 flex flex-col relative"
      onContextMenu={readOnly ? undefined : (e) => openContextMenu(e, null)}
      onDragOver={readOnly ? undefined : (e) => handleDragOver(e, null)}
      onDrop={readOnly ? undefined : (e) => handleDrop(e, null)}
    >
      <div className="px-1.5 pt-2 pb-1 border-b border-[var(--color-border-subtle)]">
        <div className="flex gap-1">
          <button type="button" className={`flex-1 h-7 rounded-lg border text-[12px] font-medium transition-colors ${!shownTrash ? 'border-[var(--color-primary-soft)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'border-[var(--color-border-light)] bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('active')} disabled={isBusy}>文档</button>
          <button type="button" className={`flex-1 h-7 rounded-lg border text-[12px] font-medium transition-colors ${shownTrash ? 'border-[var(--color-primary-soft)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'border-[var(--color-border-light)] bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]'}`} onClick={() => setViewMode('trash')} disabled={isBusy}>回收站</button>
        </div>
        {shownTrash && trashTopoDocuments.length > 0 && (
          <button type="button" className="mt-2 w-full h-7 rounded-lg border border-[var(--color-danger)] bg-transparent text-[12px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onClearTrashDocuments?.()} disabled={isBusy || !onClearTrashDocuments}>清空文档回收站</button>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full ${!shownTrash && dragState?.id === 'root' ? 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-primary)]' : ''}`}>
        {shownTrash ? (
          trashTopoDocuments.length === 0 ? (
            <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">文档回收站为空</div>
          ) : (
            trashTopoDocuments.map((item) => (
              <DocumentTrashItem
                key={item.trashName}
                item={item}
                isBusy={isBusy}
                onRestore={() => void handleRestoreTrashDocument(item.trashName)}
              />
            ))
          )
        ) : (
          <>
            {inlineEdit?.mode !== 'rename' && !inlineEdit?.parentId && inlineEdit && (
              <DocumentInlineEdit
                level={0}
                inlineEdit={inlineEdit}
                inlineInputRef={inlineInputRef}
                isBusy={isBusy}
                onChange={(value) => setInlineEdit({ ...inlineEdit, value })}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
              />
            )}
            {rootItems.map(node => (
              <DocumentNode
                key={node.id}
                readOnly={readOnly}
                node={node}
                level={0}
                activeDocumentKey={activeDocumentKey}
                childrenMap={childrenMap}
                expandedNodes={expandedNodes}
                inlineEdit={inlineEdit}
                inlineInputRef={inlineInputRef}
                isBusy={isBusy}
                draggedId={draggedId}
                dragState={dragState}
                onSelectDocument={onSelectDocument}
                onToggleExpand={toggleExpand}
                onContextMenu={openContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onInlineEditChange={(value) => setInlineEdit(prev => prev ? { ...prev, value } : null)}
                onInlineEditBlur={handleInputBlur}
                onInlineEditKeyDown={handleInputKeyDown}
              />
            ))}
            {rootItems.length === 0 && !inlineEdit && (
              <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">暂无文档</div>
            )}
          </>
        )}
      </div>

      <DocumentContextMenu
        readOnly={readOnly}
        contextMenu={contextMenu}
        activeSubmenu={activeSubmenu}
        menuRef={menuRef}
        isBusy={isBusy}
        onMouseEnterSubmenu={setActiveSubmenu}
        onMouseLeaveSubmenu={() => setActiveSubmenu(null)}
        onAction={handleContextMenuAction}
      />
    </div>
  )
}
