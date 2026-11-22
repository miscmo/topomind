import { memo } from 'react'
import { FileText } from 'lucide-react'
import type { TopoDocumentManifestItem, TopoDocumentMetaPatch, TopoDocumentType } from '../../core/storage'
import { PANEL_LIST } from '../../shared/ui/panelList'
import { EmptyState } from '../../shared/ui/EmptyState'
import { useDocumentSidebarModel } from './model/useDocumentSidebarModel'
import { DocumentNode } from './components/DocumentNode'
import { DocumentInlineEdit } from './components/DocumentInlineEdit'
import { DocumentContextMenu } from './components/DocumentContextMenu'
import { DocumentMetaPicker } from './components/DocumentMetaPicker'

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
  onMoveDocumentToCard?: (documentId: string) => void
  onUpdateDocumentMeta?: (documentPath: string, patch: TopoDocumentMetaPatch) => void
}

export const DocumentSidebar = memo(function DocumentSidebar({
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
  onMoveDocumentToCard,
  onUpdateDocumentMeta,
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
    onMoveDocumentToCard,
    onUpdateDocumentMeta,
  })

  const {
    rootItems,
    childrenMap,
    contextMenu,
    activeSubmenu,
    inlineEdit,
    metaPicker,
    stickyAncestorRows,
    expandedNodes,
    draggedId,
    dragState,
    scrollMetrics,
    scrollbarActive,
  } = state

  const { inlineInputRef, menuRef, scrollContainerRef } = refs

  const {
    setInlineEdit,
    setActiveSubmenu,
    setMetaPicker,
    toggleExpand,
    selectStickyAncestor,
    registerDocumentRow,
    getChildRenderLimit,
    showMoreChildren,
    startRename,
    openContextMenu,
    openIconPicker,
    handleContextMenuAction,
    handleApplyMeta,
    handleQuickCreate,
    openStylePanel,
    handleQuickDelete,
    handleApplyMetaPatch,
    handleInputKeyDown,
    handleInputBlur,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleSidebarScroll,
  } = actions

  return (
    <div
      data-document-sidebar-root
      className="flex-1 min-h-0 flex flex-col relative"
      onContextMenu={(e) => openContextMenu(e, null)}
      onDragOver={(e) => handleDragOver(e, null)}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className={PANEL_LIST.header}>
        <FileText className={PANEL_LIST.headerIcon} />
        <span className={PANEL_LIST.title}>文档</span>
        <span className={PANEL_LIST.count}>{topoDocuments.length} 篇</span>
      </div>
      <div
        ref={scrollContainerRef}
        onScroll={handleSidebarScroll}
        className={`flex-1 overflow-y-auto px-1.5 py-2 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${dragState?.id === 'root' ? 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-accent)]' : ''}`}
      >
        {stickyAncestorRows.length > 0 && (
          <div className="sticky top-0 z-20 h-0">
            <div
              role="tree"
              aria-label="当前文档层级路径"
              className="absolute inset-x-0 top-[-8px] flex flex-col gap-0.5 overflow-hidden bg-[var(--color-surface)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[var(--color-border)]"
            >
              {stickyAncestorRows.map(({ node, level }) => (
                <DocumentNode
                  key={`sticky-${node.id}`}
                  node={node}
                  level={level}
                  activeDocumentPath={activeDocumentPath}
                  childrenMap={childrenMap}
                  expandedNodes={expandedNodes}
                  inlineEdit={null}
                  inlineInputRef={inlineInputRef}
                  isBusy={isBusy}
                  draggedId={draggedId}
                  dragState={null}
                  onSelectDocument={selectStickyAncestor}
                  onRenameDocument={startRename}
                  onOpenIconPicker={openIconPicker}
                  onToggleExpand={toggleExpand}
                  onContextMenu={openContextMenu}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onInlineEditChange={() => undefined}
                  onInlineEditBlur={() => undefined}
                  onInlineEditKeyDown={() => undefined}
                  renderChildren={false}
                  sticky
                />
              ))}
            </div>
          </div>
        )}
        <div role="tree" aria-label="文档列表" className="flex flex-col gap-0.5 relative">
          {rootItems.length === 0 && !inlineEdit ? (
            <EmptyState
              size="sm"
              icon={<FileText className="h-4 w-4" />}
              title="还没有文档"
              description="右键空白处新建，或拖入文件"
            />
          ) : (
            <>
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
                  onRenameDocument={startRename}
                  onOpenIconPicker={openIconPicker}
                  onToggleExpand={toggleExpand}
                  onContextMenu={openContextMenu}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onInlineEditChange={(value) => setInlineEdit(prev => prev ? { ...prev, value } : null)}
                  onInlineEditBlur={handleInputBlur}
                  onInlineEditKeyDown={handleInputKeyDown}
                  onRowElement={registerDocumentRow}
                  getChildRenderLimit={getChildRenderLimit}
                  onShowMoreChildren={showMoreChildren}
                  onQuickCreate={handleQuickCreate}
                  onQuickStyle={openStylePanel}
                  onQuickDelete={handleQuickDelete}
                />
              ))}
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
            </>
          )}
        </div>
      </div>

      <div className={PANEL_LIST.footer}>右键新建 · 拖动调整层级 · 双击重命名</div>

      {/* 文档列表滚动进度条：滚动时出现、停手后淡出；贴右侧（最靠近分隔线） */}
      {scrollMetrics && (
        <div
          aria-hidden
          className="absolute right-0 inset-y-0 w-[3px] z-10 pointer-events-none transition-opacity duration-300 ease-out"
          style={{ opacity: scrollbarActive ? 1 : 0 }}
        >
          <div
            className="absolute right-0 left-0 mx-auto rounded-full bg-[color-mix(in_srgb,var(--color-text-muted)_34%,transparent)]"
            style={{ top: scrollMetrics.thumbTop, height: scrollMetrics.thumbHeight }}
          />
        </div>
      )}

      <DocumentContextMenu
        contextMenu={contextMenu}
        activeSubmenu={activeSubmenu}
        menuRef={menuRef}
        isBusy={isBusy}
        onMouseEnterSubmenu={setActiveSubmenu}
        onMouseLeaveSubmenu={() => setActiveSubmenu(null)}
        onAction={handleContextMenuAction}
      />

      <DocumentMetaPicker
        picker={metaPicker}
        onClose={() => setMetaPicker(null)}
        onApply={handleApplyMeta}
        onApplyPatch={handleApplyMetaPatch}
      />
    </div>
  )
})
