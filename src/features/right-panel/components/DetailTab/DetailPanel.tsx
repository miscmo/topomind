/**
 * 右侧详情面板
 * 显示节点文档内容，支持「本节点文档 / 关联文档」两种视图。
 *
 * 关键约定：nodePath 是**当前选中节点**，documentCardPath 是**当前文档实际所属节点**。
 * 关联文档属于别的节点，读写 / 附件 / 草稿 / 缓存键一律用 documentCardPath，
 * 否则会把内容写到当前节点的 _docs 目录（本需求最大的事故风险）。
 */
import { FolderOpen, MapPin } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, memo, useMemo, useRef, useState } from 'react'
import { useGraphStore, useGraphStoreApi, useSelectedNodeId } from '../../../../stores/graphStore'
import { DocumentWorkspace } from '../../../../features/documents/DocumentWorkspace'
import { tabStore, useGraphSession } from '../../../../stores/tabs/tabStore'
import { useStorage } from '../../../../core/storage'
import { joinRefs, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { topoDocumentPath, topoDocumentIdFromPath } from '../../../../features/documents/types/documentTypes'
import { useDetailDocuments } from '../../model/useDetailDocuments'
import { useDetailDocumentSession } from '../../model/useDetailDocumentSession'
import { useDetailPanelStore, type DetailView } from '../../model/detailPanelStore'
import { useDetailLockStore } from '../../model/detailLockStore'
import { useResolvedLinkedDocuments } from '../../model/useResolvedLinkedDocuments'
import type { DetailSidebarTab } from '../../../../features/documents/types/workspaceTypes'
import type { LinkedDocumentRef, ResolvedLinkedDocument } from '../../../../domain/graph/linkedDocuments'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
import { syncLinkedDocumentsToGraph, useLinkedDocumentStore } from '../../../graph/linkedDocumentStore'
import { DocumentBreadcrumb } from './DocumentBreadcrumb'
import { DocumentMoveToNodeDialog } from '../../../documents/components/DocumentMoveToNodeDialog'
import { LinkedDocumentList } from './LinkedDocumentList'

interface DetailPanelProps {
  tabId: string
  isActive?: boolean
}

const EMPTY_LINKS: LinkedDocumentRef[] = []

const DetailPanel = memo(function DetailPanel({ tabId, isActive = true }: DetailPanelProps) {
  const rawSelectedNodeId = useSelectedNodeId()
  // 框选期间 selectedNodeId 每帧都变；用 deferred 值让右栏松手后再追上最终节点。
  const deferredSelectedNodeId = useDeferredValue(rawSelectedNodeId)
  const graphSession = useGraphSession(tabId)
  const kbPath = graphSession.kbPath
  const lockedNodeId = useDetailLockStore((s) => (kbPath ? (s.lockedByKb[kbPath] ?? null) : null))
  const selectedNodeId = lockedNodeId ?? deferredSelectedNodeId
  const resolveNodePath = useCallback((nodeId: string) => {
    const session = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(session.roomPath || session.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  const storage = useStorage()
  const graphStoreApi = useGraphStoreApi()

  const childCount = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.childCount ?? 0 : 0)
  const nodeLabel = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.label ?? '' : '')
  const hasSelectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.has(selectedNodeId) : false)
  // selector 必须返回稳定引用：返回 `?? []` 会让画布拖动时右栏每帧重渲染。
  const storedLinkedDocuments = useGraphStore((s) => (
    selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.linkedDocuments : undefined
  ))
  const linkedDocuments = storedLinkedDocuments ?? EMPTY_LINKS

  const storedDetailView = useDetailPanelStore((state) => (
    selectedNodeId ? (state.detailViewsByNodeId[selectedNodeId] ?? 'own') : 'own'
  ))
  const setDetailViewForNode = useDetailPanelStore((state) => state.setDetailViewForNode)
  const [viewOverride, setViewOverride] = useState<{ nodeId: string; view: DetailView } | null>(null)
  const requestedView: DetailView = viewOverride?.nodeId === selectedNodeId ? viewOverride.view : storedDetailView
  const detailView: DetailView = requestedView === 'linked' && linkedDocuments.length > 0 ? 'linked' : 'own'

  const storedActiveDocumentPath = useDetailPanelStore((state) => (
    selectedNodeId ? (state.activeDocumentPathsByNodeId[selectedNodeId] ?? '') : ''
  ))
  const setActiveDocumentPathForNode = useDetailPanelStore((state) => state.setActiveDocumentPathForNode)
  const detailSidebarTab = useDetailPanelStore((state) => (
    selectedNodeId ? (state.detailSidebarTabsByNodeId[selectedNodeId] ?? 'documents') : 'documents'
  ))
  const setDetailSidebarTabForNode = useDetailPanelStore((state) => state.setDetailSidebarTabForNode)

  const setActiveDocumentPathSafe = useCallback((path: string | ((prev: string) => string)) => {
    if (!selectedNodeId) return
    const nextPath = typeof path === 'function'
      ? path(useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId] ?? '')
      : path
    setActiveDocumentPathForNode(selectedNodeId, nextPath)
  }, [selectedNodeId, setActiveDocumentPathForNode])
  const setDetailSidebarTabSafe = useCallback((tab: DetailSidebarTab) => {
    if (!selectedNodeId) return
    setDetailSidebarTabForNode(selectedNodeId, tab)
  }, [selectedNodeId, setDetailSidebarTabForNode])

  // ===== 关联文档解析（只在关联视图真正需要时打 IO） =====
  const [activeLinkedDocId, setActiveLinkedDocId] = useState<string | null>(null)
  // setter 需要读「当前视图 / 当前关联项」，但不能把它们放进 useCallback 依赖：
  // 否则 setActiveDocumentPath → loadDocuments → 主 effect 会形成重复 IO 循环。
  const detailViewRef = useRef(detailView)
  detailViewRef.current = detailView
  const activeLinkedDocIdRef = useRef(activeLinkedDocId)
  activeLinkedDocIdRef.current = activeLinkedDocId
  const [resolveTick, setResolveTick] = useState(0)
  const { resolved: resolvedLinks, loading: linksLoading } = useResolvedLinkedDocuments({
    nodeId: selectedNodeId,
    nodePath,
    links: detailView === 'linked' ? linkedDocuments : EMPTY_LINKS,
    refreshToken: resolveTick,
  })
  const activeLinked = useMemo(
    () => resolvedLinks.find((item) => item.docId === activeLinkedDocId) ?? null,
    [resolvedLinks, activeLinkedDocId],
  )

  useEffect(() => { setActiveLinkedDocId(null) }, [selectedNodeId])
  useEffect(() => {
    if (detailView !== 'linked') return
    if (activeLinkedDocId && resolvedLinks.some((item) => item.docId === activeLinkedDocId && item.status === 'ok')) return
    setActiveLinkedDocId(resolvedLinks.find((item) => item.status === 'ok')?.docId ?? null)
  }, [detailView, resolvedLinks, activeLinkedDocId])

  // 节点上的链环标记：一键切到关联视图并打开第一篇。
  const navRequest = useLinkedDocumentStore((s) => s.navRequest)
  useEffect(() => {
    if (!navRequest || navRequest.tabId !== tabId) return
    const targetNodeId = navRequest.nodeId
    if (!useLinkedDocumentStore.getState().consumeLinkedView(targetNodeId, tabId)) return
    if (targetNodeId !== selectedNodeId) {
      toast({ level: 'warn', title: '无法打开关联文档', message: '右栏已锁定到其它节点，请先解锁' })
      return
    }
    if (linkedDocuments.length === 0) return
    setDetailViewForNode(targetNodeId, 'linked')
    setViewOverride(null)
    setActiveLinkedDocId(linkedDocuments[0].docId)
  }, [navRequest, tabId, selectedNodeId, linkedDocuments, setDetailViewForNode])

  /** 文档实际所属节点：关联视图用解析出的 cardPath，本节点视图用 nodePath。 */
  const documentCardPath = detailView === 'linked'
    ? (activeLinked?.status === 'ok' && activeLinked.cardPath ? activeLinked.cardPath : null)
    : nodePath
  const activeDocumentPath = detailView === 'linked'
    ? (activeLinkedDocId ? topoDocumentPath(activeLinkedDocId) : '')
    : storedActiveDocumentPath
  const currentDocumentKey = documentCardPath ? joinRefs(documentCardPath, activeDocumentPath) : ''
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDocumentPath)

  /** 视图感知的 setter：关联视图只改内存里的活动项，不污染「本节点文档」的持久化激活位置。 */
  const setActiveDocumentPathForView = useCallback((path: string | ((prev: string) => string)) => {
    const isLinked = detailViewRef.current === 'linked'
    const prev = isLinked
      ? (activeLinkedDocIdRef.current ? topoDocumentPath(activeLinkedDocIdRef.current) : '')
      : (useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId ?? ''] ?? '')
    const next = typeof path === 'function' ? path(prev) : path
    if (isLinked) setActiveLinkedDocId(topoDocumentIdFromPath(next) || null)
    else setActiveDocumentPathSafe(next)
  }, [selectedNodeId, setActiveDocumentPathSafe])

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
    nodePath: documentCardPath,
    currentDocumentKey,
    activeDocumentPath,
    activeTopoDocumentId,
    isActive,
  })

  const allowedDocumentIds = useMemo(
    () => (detailView === 'linked' ? linkedDocuments.map((link) => link.docId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailView, linkedDocuments.map((link) => link.docId).join('|')],
  )

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
    handleMoveDocumentToCard,
    handleUpdateDocumentMeta,
    handleExportTopoDocument,
    handleOpenCurrentDocumentFolder,
  } = useDetailDocuments({
    selectedNodeId,
    nodePath: documentCardPath,
    activeDocumentPath,
    setActiveDocumentPath: setActiveDocumentPathForView,
    flushDocumentSave,
    allowedDocumentIds,
    syncHasDetail: detailView === 'own',
  })

  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('topomind_detail_sidebar_collapsed')
    return saved ? saved === 'true' : true
  })
  const [moveToNode, setMoveToNode] = useState<{ documentId: string } | null>(null)
  const autoSwitchedRef = useRef('')

  const currentTopoDocuments = documentCardPath && topoDocumentsCardPath === documentCardPath ? topoDocuments : []
  const activeTopoDocument = activeTopoDocumentId
    ? currentTopoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
  const activeDocumentDisplayName = activeTopoDocument?.title ?? ''
  const currentDocumentDisplayPath = documentCardPath
    ? (activeTopoDocument ? joinRefs(documentCardPath, `_docs/${activeTopoDocument.path}`) : '')
    : ''

  useEffect(() => {
    if (!isActive) return
    const requestSeq = ++documentListRequestSeqRef.current

    if (!selectedNodeId || !documentCardPath) {
      setTopoDocuments([])
      setTopoDocumentsCardPath('')
      return
    }

    void loadDocuments(documentCardPath, requestSeq, selectedNodeId).then((docs) => {
      if (documentListRequestSeqRef.current !== requestSeq) return
      // 关联视图的激活项由关联列表决定，不用「所属节点第一篇」覆盖。
      if (detailView === 'linked') return
      const savedActivePath = useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId] ?? ''
      const docExists = savedActivePath ? docs.some((d) => topoDocumentPath(d.id) === savedActivePath) : false
      if (savedActivePath && docExists) {
        setActiveDocumentPathSafe(savedActivePath)
      } else if (docs.length > 0) {
        setActiveDocumentPathSafe(topoDocumentPath(docs[0].id))
      } else if (linkedDocuments.length > 0) {
        // 只有关联文档、没有自身文档：直接展示关联视图，不显示空态。
        const key = `${selectedNodeId}|${linkedDocuments.length}`
        if (autoSwitchedRef.current !== key) {
          autoSwitchedRef.current = key
          setViewOverride({ nodeId: selectedNodeId, view: 'linked' })
          setActiveLinkedDocId(linkedDocuments[0].docId)
        }
      } else {
        setActiveDocumentPathSafe('')
      }
    })
  }, [isActive, selectedNodeId, documentCardPath, detailView, loadDocuments, setTopoDocuments, setTopoDocumentsCardPath, setActiveDocumentPathSafe, linkedDocuments])

  const handleDetailSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setDetailSidebarCollapsed(collapsed)
    localStorage.setItem('topomind_detail_sidebar_collapsed', String(collapsed))
  }, [])

  const handleViewChange = useCallback((view: DetailView) => {
    if (!selectedNodeId) return
    void flushDocumentSave().then(() => {
      setDetailViewForNode(selectedNodeId, view)
      setViewOverride(null)
      if (view === 'linked') setActiveLinkedDocId(linkedDocuments[0]?.docId ?? null)
    })
  }, [selectedNodeId, flushDocumentSave, setDetailViewForNode, linkedDocuments])

  const openLinkDialog = useCallback(() => {
    if (!selectedNodeId || !nodePath) return
    useLinkedDocumentStore.getState().openDialog({
      nodeId: selectedNodeId,
      cardPath: nodePath,
      label: nodeLabel,
      links: linkedDocuments,
    })
  }, [selectedNodeId, nodePath, nodeLabel, linkedDocuments])

  const removeLinked = useCallback(async (docId: string) => {
    if (!selectedNodeId || !nodePath) return
    try {
      const saved = await storage.updateNodeLinkedDocuments(
        nodePath,
        linkedDocuments.filter((link) => link.docId !== docId),
      )
      syncLinkedDocumentsToGraph(selectedNodeId, saved)
      if (activeLinkedDocId === docId) setActiveLinkedDocId(null)
      if (saved.length === 0) handleViewChange('own')
    } catch (error) {
      toast({ level: 'error', title: '移除关联失败', message: (error as Error)?.message || String(error) })
    }
  }, [selectedNodeId, nodePath, storage, linkedDocuments, activeLinkedDocId, handleViewChange])

  const restoreLinked = useCallback(async (link: ResolvedLinkedDocument) => {
    if (!link.trashName || !link.cardPath) return
    try {
      await storage.restoreTrashTopoDocument(link.cardPath, link.trashName)
      setResolveTick((tick) => tick + 1)
      toast({ level: 'info', title: '已从回收站恢复', message: link.title })
    } catch (error) {
      toast({ level: 'error', title: '恢复文档失败', message: (error as Error)?.message || String(error) })
    }
  }, [storage])

  const openOwnerNode = useCallback((link: ResolvedLinkedDocument) => {
    const cardPath = link.cardPath || link.cardRef
    const parts = cardPath.split('/').filter(Boolean)
    const targetNodeId = parts.pop()
    if (!targetNodeId) return
    const roomPath = parts.join('/') || kbPath
    tabStore.getState().enterRoomInTab(tabId, { path: roomPath, kbPath, name: link.nodeName || targetNodeId })
    setDetailViewForNode(targetNodeId, 'own')
    // 房间是异步重新加载的，等节点进入 nodesMap 后再选中，右栏即展示它的自身文档树。
    window.setTimeout(() => {
      const state = graphStoreApi.getState()
      if (!state.nodesMap.has(targetNodeId)) return
      state.setNodes(Array.from(state.nodesMap.values()).map((node) => ({
        ...node,
        selected: node.id === targetNodeId,
      })))
    }, 350)
  }, [tabId, kbPath, setDetailViewForNode, graphStoreApi])

  const linkedSidebarContent = useMemo(() => (detailView === 'linked' ? (
    <LinkedDocumentList
      links={resolvedLinks}
      activeDocId={activeLinkedDocId}
      loading={linksLoading}
      onSelect={(docId) => { void handleSelectDocument(topoDocumentPath(docId)) }}
      onRemove={(docId) => { void removeLinked(docId) }}
      onRestore={(link) => { void restoreLinked(link) }}
      onOpenOwner={(link) => openOwnerNode(link)}
      onAdd={openLinkDialog}
    />
  ) : undefined), [detailView, resolvedLinks, activeLinkedDocId, linksLoading, handleSelectDocument, removeLinked, restoreLinked, openOwnerNode, openLinkDialog])

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
      <div className="flex-1 flex min-h-0 overflow-hidden p-0 leading-relaxed text-[13px] [&>*]:flex-1 [&>*]:min-h-0 [&>*]:min-w-0">
        {isActive ? <DocumentWorkspace
          value={draftContent}
          isDirty={isDocumentDirty}
          isContentLoaded={isContentLoaded}
          onChange={handleDraftChange}
          onSave={handleSave}
          attachmentCardPath={documentCardPath}
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
                          <FolderOpen className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {childCount > 0 && (
                        <span className="py-0.5 px-[7px] rounded-lg bg-[var(--color-hover-bg)] text-[10px] text-[var(--color-text-muted)] shrink-0" title="含有子概念">
                          {childCount} 子
                        </span>
                      )}
                    </div>
                    {detailView === 'linked' ? (
                      <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] min-w-0 truncate" title={`来源：${activeLinked?.sourceLabel || '未知位置'} / ${activeDocumentDisplayName}`}>
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">来源：{activeLinked?.sourceLabel || '未知位置'} / {activeDocumentDisplayName}</span>
                      </div>
                    ) : topoDocuments.length > 0 && (
                      <DocumentBreadcrumb
                        topoDocuments={topoDocuments}
                        activeTopoDocumentId={activeTopoDocumentId || null}
                        onSelectDocument={(path) => void handleSelectDocument(path)}
                        nodeLabel={nodeLabel}
                        onCreateDocument={(type, name, parentId) => { void handleCreateTopoDocument(type, name, parentId) }}
                        onRenameDocument={(path, name) => { void handleRenameDocument(path, name) }}
                        onDeleteDocument={(path) => { void handleDeleteDocument(path) }}
                        onExportDocument={(path) => { void handleExportTopoDocument(path) }}
                        onUpdateDocumentMeta={(path, patch) => { void handleUpdateDocumentMeta(path, patch) }}
                      />
                    )}
                  </div>
                </div>
                {linkedDocuments.length > 0 && (
                  <SegmentedControl<DetailView>
                    size="sm"
                    fullWidth={false}
                    grow={false}
                    ariaLabel="文档来源"
                    value={detailView}
                    onChange={handleViewChange}
                    options={[
                      { label: '本节点文档', value: 'own' },
                      { label: `关联文档 · ${linkedDocuments.length}`, value: 'linked' },
                    ]}
                  />
                )}
              </div>
              {documentLinkNotice && (
                <div className="mt-0.5 py-1.5 px-2.5 border border-[var(--color-warning-border)] rounded-lg bg-[var(--color-warning-soft)] text-[var(--color-warning)] text-xs leading-snug" role="status">
                  {documentLinkNotice}
                </div>
              )}
            </div>
          )}
          documentsTabContent={linkedSidebarContent}
          topoDocuments={topoDocuments}
          activeDocumentPath={activeDocumentPath}
          detailSidebarTab={detailSidebarTab}
          onDetailSidebarTabChange={setDetailSidebarTabSafe}
          onSelectDocument={(documentPath: string) => { void handleSelectDocument(documentPath) }}
          onOpenDetailDocumentLink={(documentPath: string) => { void handleOpenDetailDocumentLink(documentPath) }}
          onCreateTopoDocument={detailView === 'linked'
            ? () => toast({ level: 'warn', title: '关联视图不新建文档', message: '请切换回「本节点文档」后新建' })
            : (type, name: string, parentId?: string | null) => { void handleCreateTopoDocument(type, name, parentId) }}
          onExportTopoDocument={(documentPath: string) => { void handleExportTopoDocument(documentPath) }}
          onRenameDocument={(documentPath: string, name: string) => { void handleRenameDocument(documentPath, name) }}
          onDeleteDocument={(documentPath: string) => { void handleDeleteDocument(documentPath) }}
          onMoveDocument={(documentId: string, newParentId: string | null, newSortOrder: number) => { void handleMoveDocument(documentId, newParentId, newSortOrder) }}
          onMoveDocumentToCard={(documentId: string) => { setMoveToNode({ documentId }) }}
          onUpdateDocumentMeta={(documentPath: string, patch: { icon?: string | null; color?: string | null }) => { void handleUpdateDocumentMeta(documentPath, patch) }}
          isDocumentBusy={isDocumentBusy}
          nodeId={selectedNodeId}
        /> : (
          <div className="h-full w-full" aria-hidden="true" />
        )}
      </div>
      {moveToNode && (
        <DocumentMoveToNodeDialog
          sourceNodePath={documentCardPath ?? ''}
          resolveNodePath={resolveNodePath}
          sourceTitle={topoDocuments.find((d) => d.id === moveToNode.documentId)?.title}
          onConfirm={(targetCardPath: string) => {
            setMoveToNode(null)
            void handleMoveDocumentToCard(moveToNode.documentId, targetCardPath)
          }}
          onClose={() => setMoveToNode(null)}
        />
      )}
    </div>
  )
})

export default DetailPanel
