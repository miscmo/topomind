/**
 * 右侧详情面板
 * 显示节点 文档内容，支持预览/编辑切换
 */
import { useEffect, useState, memo, useCallback } from 'react'
import { useGraphStore, useSelectedNodeId } from '../../../../stores/graphStore'
import { DocumentWorkspace } from '../../../../features/documents/DocumentWorkspace'
import { tabStore } from '../../../../stores/tabs/tabStore'
import { joinRefs, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { topoDocumentPath, topoDocumentIdFromPath } from '../../../../features/documents/types/documentTypes'
import { useDetailDocuments } from '../../model/useDetailDocuments'
import { useDetailDocumentSession } from '../../model/useDetailDocumentSession'
import { useDetailPanelStore } from '../../model/detailPanelStore'
import type { DetailSidebarTab } from '../../../../features/documents/types/workspaceTypes'
import { DocumentBreadcrumb } from './DocumentBreadcrumb'

interface DetailPanelProps {
  tabId: string
  isActive?: boolean
}

const DetailPanel = memo(function DetailPanel({ tabId, isActive = true }: DetailPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  // Use granular selectors to prevent re-renders on position changes (e.g. during dragging)
  const childCount = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.childCount ?? 0 : 0)
  const nodeLabel = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.label ?? '' : '')
  const hasSelectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.has(selectedNodeId) : false)

  const activeDocumentPath = useDetailPanelStore((state) => (
    selectedNodeId ? (state.activeDocumentPathsByNodeId[selectedNodeId] ?? '') : ''
  ))
  const setActiveDocumentPathForNode = useDetailPanelStore((state) => state.setActiveDocumentPathForNode)
  const detailSidebarTab = useDetailPanelStore((state) => (
    selectedNodeId ? (state.detailSidebarTabsByNodeId[selectedNodeId] ?? 'documents') : 'documents'
  ))
  const setDetailSidebarTabForNode = useDetailPanelStore((state) => state.setDetailSidebarTabForNode)

  const setActiveDocumentPathSafe = useCallback((path: string | ((prev: string) => string)) => {
    if (!selectedNodeId) return
    const nextPath = typeof path === 'function' ? path(useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId] ?? '') : path
    setActiveDocumentPathForNode(selectedNodeId, nextPath)
  }, [selectedNodeId, setActiveDocumentPathForNode])
  const setDetailSidebarTabSafe = useCallback((tab: DetailSidebarTab) => {
    if (!selectedNodeId) return
    setDetailSidebarTabForNode(selectedNodeId, tab)
  }, [selectedNodeId, setDetailSidebarTabForNode])
  const currentDocumentKey = nodePath ? joinRefs(nodePath, activeDocumentPath) : ''
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDocumentPath)

  const {
    draftContent,
    isDocumentDirty,
    isContentLoaded,
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
    isActive,
  })

  const {
    topoDocuments,
    setTopoDocuments,
    topoDocumentsCardPath,
    setTopoDocumentsCardPath,
    isDocumentBusy,
    documentLinkNotice,
    documentListRequestSeqRef,
    loadDocuments,
    handleSelectDocument,
    handleOpenDetailDocumentLink,
    handleCreateTopoDocument,
    handleRenameDocument,
    handleDeleteDocument,
    handleMoveDocument,
    handleExportTopoDocument,
    handleOpenCurrentDocumentFolder,
  } = useDetailDocuments({
    selectedNodeId,
    nodePath,
    activeDocumentPath,
    setActiveDocumentPath: setActiveDocumentPathSafe,
    flushDocumentSave,
  })

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
    if (!isActive) return
    const requestSeq = ++documentListRequestSeqRef.current

    if (!selectedNodeId || !nodePath) {
      setTopoDocuments([])
      setTopoDocumentsCardPath('')
      return
    }

    void loadDocuments(nodePath, requestSeq, selectedNodeId).then((docs) => {
      if (documentListRequestSeqRef.current !== requestSeq) return

      const savedActivePath = useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId] ?? ''
      const docExists = savedActivePath ? docs.some((d) => topoDocumentPath(d.id) === savedActivePath) : false

      if (savedActivePath && docExists) {
        setActiveDocumentPathSafe(savedActivePath)
      } else if (docs.length > 0) {
        setActiveDocumentPathSafe(topoDocumentPath(docs[0].id))
      } else {
        setActiveDocumentPathSafe('')
      }
    })
  }, [isActive, selectedNodeId, nodePath, loadDocuments, setTopoDocuments, setTopoDocumentsCardPath, setActiveDocumentPathSafe])



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
        {isActive ? <DocumentWorkspace
          value={draftContent}
          isDirty={isDocumentDirty}
          isContentLoaded={isContentLoaded}
          onChange={handleDraftChange}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          detailSidebarCollapsed={detailSidebarCollapsed}
          detailSidebarFloating={false}
          onDetailSidebarCollapsedChange={handleDetailSidebarCollapsedChange}
          onSidebarHoverChange={() => {}}
          detailHeader={(
            <div className="min-h-[48px] px-4 py-2 border-b border-[var(--color-border-light)] shrink-0 flex flex-col justify-center gap-1 bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] box-border">
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex flex-col gap-[3px] min-w-0 flex-1 group">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="text-base font-bold text-[var(--color-primary)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        title={currentDocumentDisplayPath || undefined}
                      >
                        {activeDocumentDisplayName}
                      </span>
                      {activeTopoDocumentId && (
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] cursor-pointer border-none bg-transparent flex items-center justify-center shrink-0"
                          title={`在文件管理器中打开：${currentDocumentDisplayPath}`}
                          onClick={() => { void handleOpenCurrentDocumentFolder(activeTopoDocumentId) }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                      )}
                      {childCount > 0 && (
                        <span className="py-0.5 px-[7px] rounded-[10px] bg-[var(--color-hover-bg)] text-[10px] text-[var(--color-text-muted)] shrink-0" title="含有子概念">
                          {childCount} 子
                        </span>
                      )}
                    </div>
                    {topoDocuments.length > 0 && (
                      <DocumentBreadcrumb
                        topoDocuments={topoDocuments}
                        activeTopoDocumentId={activeTopoDocumentId || null}
                        onSelectDocument={(path) => void handleSelectDocument(path)}
                        nodeLabel={nodeLabel}
                        onCreateDocument={(type, name, parentId) => { void handleCreateTopoDocument(type, name, parentId) }}
                        onRenameDocument={(path, name) => { void handleRenameDocument(path, name) }}
                        onDeleteDocument={(path) => { void handleDeleteDocument(path) }}
                        onExportDocument={(path) => { void handleExportTopoDocument(path) }}
                      />
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
          activeDocumentPath={activeDocumentPath}
          detailSidebarTab={detailSidebarTab}
          onDetailSidebarTabChange={setDetailSidebarTabSafe}
          onSelectDocument={(documentPath: string) => { void handleSelectDocument(documentPath) }}
          onOpenDetailDocumentLink={(documentPath: string) => { void handleOpenDetailDocumentLink(documentPath) }}
          onCreateTopoDocument={(type, name: string, parentId?: string | null) => { void handleCreateTopoDocument(type, name, parentId) }}
          onExportTopoDocument={(documentPath: string) => { void handleExportTopoDocument(documentPath) }}
          onRenameDocument={(documentPath: string, name: string) => { void handleRenameDocument(documentPath, name) }}
          onDeleteDocument={(documentPath: string) => { void handleDeleteDocument(documentPath) }}
          onMoveDocument={(documentId: string, newParentId: string | null, newSortOrder: number) => { void handleMoveDocument(documentId, newParentId, newSortOrder) }}
          isDocumentBusy={isDocumentBusy}
          nodeId={selectedNodeId}
        /> : (
          <div className="h-full w-full" aria-hidden="true" />
        )}
      </div>
    </div>
  )
})

export default DetailPanel
