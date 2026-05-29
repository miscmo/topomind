/**
 * 右侧详情面板
 * 显示节点 文档内容，支持预览/编辑切换
 */
import { useEffect, useState, memo, useCallback } from 'react'
import { useGraphStore, useSelectedNodeId, useGraphStoreApi } from '../../../../stores/graphStore'
import { DocumentWorkspace } from '../../../../features/documents/DocumentWorkspace'
import { tabStore } from '../../../../stores/tabs/tabStore'
import { joinRefs, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { topoDocumentPath, topoDocumentIdFromPath } from '../../../../features/documents/types/documentTypes'
import { useDetailDocuments } from '../../model/useDetailDocuments'
import { useDetailDocumentSession } from '../../model/useDetailDocumentSession'

interface DetailPanelProps {
  tabId: string
}

const DetailPanel = memo(function DetailPanel({ tabId }: DetailPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storeApi = useGraphStoreApi()

  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  // Use granular selectors to prevent re-renders on position changes (e.g. during dragging)
  const childCount = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.childCount ?? 0 : 0)
  const nodeLabel = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.label ?? '' : '')
  const hasSelectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.has(selectedNodeId) : false)

  const [activeDocumentPath, setActiveDocumentPath] = useState('')
  const currentDocumentKey = nodePath ? joinRefs(nodePath, activeDocumentPath) : ''
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDocumentPath)

  const {
    draftContent,
    isDocumentDirty,
    loadedDocumentKey,
    handleDraftChange,
    handleSave,
    flushDocumentSave,
  } = useDetailDocumentSession({
    tabId,
    selectedNodeId,
    nodePath,
    currentDocumentKey,
    activeDocumentPath,
    activeTopoDocumentId,
  })

  const {
    topoDocuments,
    trashTopoDocuments,
    setTopoDocuments,
    topoDocumentsCardPath,
    setTopoDocumentsCardPath,
    isDocumentBusy,
    documentLinkNotice,
    documentListRequestSeqRef,
    loadDocuments,
    loadTrashDocuments,
    handleSelectDocument,
    handleOpenDetailDocumentLink,
    handleCreateTopoDocument,
    handleRenameDocument,
    handleDeleteDocument,
    handleRestoreDocument,
    handleClearTrashDocuments,
    handleMoveDocument,
    handleExportTopoDocument,
    handleOpenCurrentDocumentFolder,
  } = useDetailDocuments({
    selectedNodeId,
    nodePath,
    activeDocumentPath,
    setActiveDocumentPath,
    flushDocumentSave,
  })

  useEffect(() => {
    if (selectedNodeId) {
      const hasDetail = topoDocuments.length > 0
      const node = storeApi.getState().nodesMap.get(selectedNodeId)
      if (node && node.data.hasDetail !== hasDetail) {
        storeApi.getState().updateNode(selectedNodeId, n => ({
          ...n,
          data: { ...n.data, hasDetail }
        }))
      }
    }
  }, [topoDocuments, selectedNodeId, storeApi])

  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('topomind_detail_sidebar_collapsed')
    return saved ? saved === 'true' : true
  })

  const currentTopoDocuments = nodePath && topoDocumentsCardPath === nodePath ? topoDocuments : []
  const activeTopoDocument = activeTopoDocumentId
    ? currentTopoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
  const activeDocumentDisplayName = activeTopoDocument?.title ?? ''
  const currentDocumentDisplayPath = nodePath
    ? (activeTopoDocument ? joinRefs(nodePath, `_docs/${activeTopoDocument.path}`) : '')
    : ''

  useEffect(() => {
    const requestSeq = ++documentListRequestSeqRef.current
    // When node changes, reset state
    setActiveDocumentPath('')
    setTopoDocuments([])
    loadTrashDocuments('')
    setTopoDocumentsCardPath('')

    if (!selectedNodeId || !nodePath) return
    
    // After loading, ensure active path is set to the first document if available
    void loadDocuments(nodePath, requestSeq).then((docs) => {
      if (documentListRequestSeqRef.current !== requestSeq) return
      if (docs.length > 0) {
        setActiveDocumentPath(topoDocumentPath(docs[0].id))
      }
    })
    void loadTrashDocuments(nodePath)
  }, [selectedNodeId, nodePath, loadDocuments, loadTrashDocuments])

  const handleDetailSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setDetailSidebarCollapsed(collapsed)
    localStorage.setItem('topomind_detail_sidebar_collapsed', String(collapsed))
  }, [])

  // ===== Empty state =====
  if (!selectedNodeId || !hasSelectedNode) {
    return (
      <div id="detail-panel" className="w-full flex-1 flex flex-col min-h-0 min-w-0 bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] shrink-0 overflow-hidden transition-opacity">
        <div className="p-4 text-xs text-[var(--color-text-muted)] text-center mt-[40%]">选择一个节点查看详情</div>
      </div>
    )
  }

  return (
    <div id="detail-panel" className="w-full flex-1 flex flex-col min-h-0 min-w-0 bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] shrink-0 overflow-hidden transition-opacity">
      <div className="flex-1 flex min-h-0 overflow-hidden p-0 leading-relaxed text-[13.5px] [&>*]:flex-1 [&>*]:min-h-0 [&>*]:min-w-0">
        <DocumentWorkspace
          value={draftContent}
          isDirty={isDocumentDirty}
          isContentLoaded={loadedDocumentKey === currentDocumentKey}
          onChange={handleDraftChange}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          detailSidebarCollapsed={detailSidebarCollapsed}
          detailSidebarFloating={false}
          onDetailSidebarCollapsedChange={handleDetailSidebarCollapsedChange}
          onSidebarHoverChange={() => {}}
          detailHeader={(
            <div className="min-h-[58px] px-4 pt-2.5 pb-2 border-b border-[var(--color-border-light)] shrink-0 flex flex-col justify-center gap-1 bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] box-border">
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex flex-col gap-[3px] min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="text-base font-bold text-[var(--color-primary)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        title={currentDocumentDisplayPath || undefined}
                      >
                        {activeDocumentDisplayName}
                      </span>
                      {childCount > 0 && (
                        <span className="py-0.5 px-[7px] rounded-[10px] bg-[var(--color-hover-bg)] text-[10px] text-[var(--color-text-muted)] shrink-0" title="含有子概念">
                          {childCount} 子
                        </span>
                      )}
                    </div>
                    {activeTopoDocumentId ? (
                      <button
                        type="button"
                        className="block max-w-full p-0 border-none bg-transparent text-left text-[11px] font-medium text-[var(--color-text-muted)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:text-[var(--color-primary)] hover:underline"
                        title={`在文件管理器中打开：${currentDocumentDisplayPath}`}
                        onClick={() => { void handleOpenCurrentDocumentFolder(activeTopoDocumentId) }}
                      >
                        {currentDocumentDisplayPath}
                      </button>
                    ) : (
                      <div className="text-[11px] font-medium text-[var(--color-text-muted)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{currentDocumentDisplayPath}</div>
                    )}
                  </div>
                </div>
              </div>
              {documentLinkNotice && (
                <div className="mt-0.5 py-1.5 px-2.5 border border-[var(--color-warning-border)] rounded-lg bg-[var(--color-warning-soft)] text-[var(--color-warning)] text-xs leading-snug" role="status">
                  {documentLinkNotice}
                </div>
              )}
            </div>
          )}
          topoDocuments={topoDocuments}
          trashTopoDocuments={trashTopoDocuments}
          activeDocumentPath={activeDocumentPath}
          onSelectDocument={(documentPath: string) => { void handleSelectDocument(documentPath) }}
          onOpenDetailDocumentLink={(documentPath: string) => { void handleOpenDetailDocumentLink(documentPath) }}
          onCreateTopoDocument={(type, name: string, parentId?: string | null) => { void handleCreateTopoDocument(type, name, parentId) }}
          onExportTopoDocument={(documentPath: string) => { void handleExportTopoDocument(documentPath) }}
          onRenameDocument={(documentPath: string, name: string) => { void handleRenameDocument(documentPath, name) }}
          onDeleteDocument={(documentPath: string) => { void handleDeleteDocument(documentPath) }}
          onRestoreDocument={(trashName: string) => handleRestoreDocument(trashName)}
          onClearTrashDocuments={() => { void handleClearTrashDocuments() }}
          onMoveDocument={(documentId: string, newParentId: string | null, newSortOrder: number) => { void handleMoveDocument(documentId, newParentId, newSortOrder) }}
          isDocumentBusy={isDocumentBusy}
        />
      </div>
    </div>
  )
})

export default DetailPanel
