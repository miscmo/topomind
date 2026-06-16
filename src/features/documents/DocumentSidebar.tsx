import React from 'react'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'
import { useDocumentSidebarModel } from './model/useDocumentSidebarModel'
import { DocumentNode } from './components/DocumentNode'
import { DocumentInlineEdit } from './components/DocumentInlineEdit'
import { DocumentContextMenu } from './components/DocumentContextMenu'

export interface DocumentSidebarProps {
  nodeId?: string
  topoDocuments: TopoDocumentManifestItem[]
  activeDocumentPath: string
  isBusy?: boolean
  onSelectDocument: (documentPath: string) => void
  onCreateTopoDocument: (type: TopoDocumentType, name: string, parentId?: string | null) => void
  onExportTopoDocument: (documentPath: string) => void
  onRenameDocument: (documentPath: string, name: string) => void
  onDeleteDocument: (documentPath: string) => void
  onMoveDocument?: (documentId: string, newParentId: string | null, newSortOrder: number) => void
}

export function DocumentSidebar({
  nodeId,
  topoDocuments,
  activeDocumentPath,
  isBusy,
  onSelectDocument,
  onCreateTopoDocument,
  onExportTopoDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
}: DocumentSidebarProps) {
  const { state, refs, actions } = useDocumentSidebarModel({
    nodeId,
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
    expandedNodes,
    draggedId,
    dragState,
  } = state

  const { inlineInputRef, menuRef } = refs

  const {
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

  return (
    <div 
      className="flex-1 min-h-0 flex flex-col relative"
      onContextMenu={(e) => openContextMenu(e, null)}
      onDragOver={(e) => handleDragOver(e, null)}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className={`flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#94a3b857] [&::-webkit-scrollbar-thumb]:rounded-full ${dragState?.id === 'root' ? 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-primary)]' : ''}`}>
        <div className="flex flex-col gap-0.5 relative">
          {rootItems.length === 0 && !inlineEdit ? (
            <div className="py-8 px-4 text-center text-[var(--color-text-muted)] text-[13px] leading-[1.6]">
              <div className="mb-2 text-[24px]">📄</div>
              还没有文档<br />
              右键或拖拽文件到这里
            </div>
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
                  node={node}
                  level={0}
                  activeDocumentPath={activeDocumentPath}
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
            </>
          )}
        </div>
      </div>

      <DocumentContextMenu
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
