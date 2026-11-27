/**
 * 右侧详情面板
 * 显示节点文档内容，支持「本节点文档 / 关联文档」两种视图。
 *
 * 关键约定：nodePath 是**当前选中节点**，documentCardPath 是**当前文档实际所属节点**。
 * 关联文档属于别的节点，读写 / 附件 / 草稿 / 缓存键一律用 documentCardPath，
 * 否则会把内容写到当前节点的 _docs 目录（本需求最大的事故风险）。
 */
import { FolderOpen, Link2, Lock, MapPin, Pin, PinOff } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, memo, useMemo, useRef, useState } from 'react'
import { useGraphStore, useGraphStoreApi, useSelectedNodeId } from '../../../../stores/graphStore'
import { useRightPanelStore } from '../../../../stores/rightPanelStore'
import { DocumentWorkspace } from '../../../../features/documents/DocumentWorkspace'
import { tabStore, useGraphSession } from '../../../../stores/tabs/tabStore'
import { useStorage } from '../../../../core/storage'
import type { TopoDocumentMetaPatch, TopoDocumentType } from '../../../../core/storage'
import { joinRefs, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { topoDocumentPath, topoDocumentIdFromPath } from '../../../../features/documents/types/documentTypes'
import { useDetailDocuments } from '../../model/useDetailDocuments'
import { useDetailDocumentSession } from '../../model/useDetailDocumentSession'
import { useDetailPanelStore, type DetailView } from '../../model/detailPanelStore'
import { useReferencePreviewStore } from '../../model/referencePreviewStore'
import { useDetailLockStore } from '../../model/detailLockStore'
import { useResolvedLinkedDocuments } from '../../model/useResolvedLinkedDocuments'
import type { DetailSidebarTab } from '../../../../features/documents/types/workspaceTypes'
import type { LinkedDocumentRef, ResolvedLinkedDocument } from '../../../../domain/graph/linkedDocuments'
import { recordUser } from '../../../../core/observe'
import { LOG_ACTIONS } from '../../../../shared/observability/logContract'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
import {
  clearReferenceOpenHandler,
  setReferenceOpenHandler,
  type ReferenceOpenPayload,
} from '@/features/documents/SmartDocumentEditor/docLinkBridge'
import { syncLinkedDocumentsToGraph, useLinkedDocumentStore } from '../../../graph/linkedDocumentStore'
import { DocumentBreadcrumb } from './DocumentBreadcrumb'
import { DocumentMoveToNodeDialog } from '../../../documents/components/DocumentMoveToNodeDialog'
import { LinkedDocumentList } from './LinkedDocumentList'
import { DocumentRelationPanel } from './DocumentRelationPanel'
import { useDocumentRelations } from '../../model/useDocumentRelations'

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
  const lockedTarget = useDetailLockStore((s) => (kbPath ? (s.lockedByKb[kbPath] ?? null) : null))
  const unlock = useDetailLockStore((s) => s.unlock)
  const lockedNodeId = lockedTarget?.nodeId ?? null
  const selectedNodeId = lockedNodeId ?? deferredSelectedNodeId
  const lockedRoomPath = lockedTarget?.roomPath ?? ''
  const resolveNodePath = useCallback((nodeId: string) => {
    const session = tabStore.getState().getGraphSession(tabId)
    // 锁定节点可能属于另一个房间：文档目录按锁定时记录的房间解析，
    // 不能用当前房间路径，否则会读到空目录或别的节点。
    const roomPath = lockedRoomPath || session.roomPath || session.kbPath
    return resolveRoomChildRef(roomPath, nodeId)
  }, [tabId, lockedRoomPath])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  const storage = useStorage()
  const graphStoreApi = useGraphStoreApi()
  // 空状态下也要能取消 pin：画布点击会清空选中，文档布局随之卸载，
  // 固定入口必须放在 DetailPanel 这一层，否则 pin 后点击画布就再也解不开。
  const isRightPanelPinned = useRightPanelStore((s) => s.rightPanelPinned)
  const toggleRightPanelPinned = useRightPanelStore((s) => s.toggleRightPanelPinned)

  const graphChildCount = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.childCount ?? 0 : 0)
  const graphNodeLabel = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId)?.data.label ?? '' : '')
  const nodeInCurrentRoom = useGraphStore((s) => selectedNodeId ? s.nodesMap.has(selectedNodeId) : false)
  // 当前房间的 nodesMap 只含本房间节点；锁定目标在别的房间时不能因此进空状态。
  const lockedOutsideRoom = !!lockedTarget && !!lockedRoomPath
    && lockedRoomPath !== (graphSession.roomPath || graphSession.kbPath)
  const childCount = nodeInCurrentRoom ? graphChildCount : (lockedTarget?.childCount ?? 0)
  const nodeLabel = graphNodeLabel || lockedTarget?.label || ''
  const hasSelectedNode = nodeInCurrentRoom || lockedOutsideRoom
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

  // 「引用关系」：只在切到该侧栏页时才打 IPC。主进程走关系索引 + 签名自愈，
  // 出入链由一次查询同时返回，上下两栏共用，不再每次读全库 2000+ 篇正文。
  const relationsEnabled = isActive && detailSidebarTab === 'backlinks' && Boolean(activeTopoDocumentId)
  const {
    incoming,
    outgoing,
    parsed,
    indexed,
    loading: relationsLoading,
    refresh: refreshRelations,
  } = useDocumentRelations(activeTopoDocumentId, relationsEnabled)

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

  /**
   * 点击正文 docLink chip / 「被引用」列表项：按全库稳定 docId 打开并定位到
   * 目标文档，必要时切房间并选中目标节点。这是文档双链自己的「导航」语义。
   * 不信任 chip 上缓存的标题或位置，一律 resolveDocumentById 反查真实 cardPath；
   * 目标已删除 / 在回收站时给出明确提示，而不是把内容写到当前节点。
   *
   * 注意：AI 回答里的 [ref:i] **不走这里** —— 那只是临时预览，见下面的
   * openReferencePreview。两者语义不同，不要图省事复用同一条链路。
   * @returns 是否真的完成跳转，供调用方决定要不要给出降级提示。
   */
  const openDocumentByDocId = useCallback(async (docId: string): Promise<boolean> => {
    const id = docId.trim()
    if (!id) return false
    try {
      const resolution = await storage.resolveDocumentById(id)
      if (resolution.status !== 'ok' || !resolution.cardPath) {
        toast({
          level: 'warn',
          title: '无法打开引用',
          message: resolution.status === 'trashed' ? '引用的文档在回收站中' : '引用的文档已不存在',
        })
        return false
      }
      // P2 T2.5：「打开文档」此前完全无日志。记录用户动作本身与反查到的
      // 目标节点，label 在契约层会被替换为长度摘要（D3 不落明文标题）。
      void recordUser(LOG_ACTIONS.userDocumentOpen, {
        target: { type: 'document', id, label: resolution.nodeName },
        view: 'detail-panel',
        result: 'resolved',
        params: { documentId: id, fromNodeId: selectedNodeId ?? '' },
        inputMode: 'docLink',
      })
      // 切换文档前先把当前草稿落盘；没有选中节点 / 编辑器未挂载时它是 no-op，
      // 因此这条链路不需要「画布已选中节点」作为前置条件。
      await flushDocumentSave()
      const targetPath = topoDocumentPath(id)
      setDetailSidebarTabSafe('documents')

      if (resolution.cardPath === nodePath && selectedNodeId) {
        // 同一节点：先切回「本节点文档」视图，再设置激活项；关联视图的 setter
        // 只会改 activeLinkedDocId，不能用来打开节点自身文档树里的文档。
        setDetailViewForNode(selectedNodeId, 'own')
        setViewOverride(null)
        setActiveDocumentPathSafe(targetPath)
        return true
      }

      if (resolution.cardPath === '__ROOT__') {
        toast({ level: 'warn', title: '无法打开引用', message: '目标文档位于工作区根节点，请先切换到根节点' })
        return false
      }
      if (lockedNodeId) {
        toast({ level: 'warn', title: '无法打开引用', message: '右栏已锁定到当前节点，请先解锁' })
        return false
      }

      const parts = resolution.cardPath.split('/').filter(Boolean)
      const targetNodeId = parts.pop()
      if (!targetNodeId) return false
      const roomPath = parts.join('/') || kbPath
      // 房间异步重载后再由主 effect 读到这个激活项；先写 store 才不会丢。
      const panelStore = useDetailPanelStore.getState()
      panelStore.setActiveDocumentPathForNode(targetNodeId, targetPath)
      panelStore.setDetailSidebarTabForNode(targetNodeId, 'documents')
      setDetailViewForNode(targetNodeId, 'own')
      tabStore.getState().enterRoomInTab(tabId, { path: roomPath, kbPath, name: resolution.nodeName || targetNodeId })
      window.setTimeout(() => {
        const state = graphStoreApi.getState()
        if (!state.nodesMap.has(targetNodeId)) return
        state.setNodes(Array.from(state.nodesMap.values()).map((node) => ({
          ...node,
          selected: node.id === targetNodeId,
        })))
      }, 350)
      return true
    } catch (error) {
      toast({ level: 'error', title: '打开引用失败', message: (error as Error)?.message || String(error) })
      return false
    }
  }, [
    storage, flushDocumentSave, selectedNodeId, nodePath, kbPath, tabId,
    lockedNodeId, graphStoreApi, setDetailSidebarTabSafe, setDetailViewForNode,
    setActiveDocumentPathSafe,
  ])

  /**
   * P5-r：AI 回答里的 [ref:i] 指向的文档只在右栏**临时、只读预览**。
   *
   * 与 openDocumentByDocId 的根本区别：这里完全不碰画布 —— 不 enterRoomInTab、
   * 不 setNodes 选中目标节点、不写 detailPanelStore 的激活项、不 flush 当前草稿
   * （DetailPanel 保持挂载，编辑器不会被卸载）。目标文档在别的房间 / 知识库
   * 甚至在 __ROOT__ 都能直接读，不需要用户先「切换过去」。
   * @returns 是否成功打开预览，供引用桥决定要不要给出降级提示。
   */
  const openReferencePreview = useCallback(async (payload: ReferenceOpenPayload): Promise<boolean> => {
    const id = payload.docId.trim()
    if (!id) return false
    try {
      const resolution = await storage.resolveDocumentById(id)
      if (resolution.status !== 'ok' || !resolution.cardPath) {
        toast({
          level: 'warn',
          title: '无法预览引用',
          message: resolution.status === 'trashed' ? '引用的文档在回收站中' : '引用的文档已不存在',
        })
        return false
      }
      void recordUser(LOG_ACTIONS.userDocumentOpen, {
        target: { type: 'document', id, label: resolution.nodeName },
        view: 'reference-preview',
        result: 'resolved',
        params: { documentId: id, fromNodeId: selectedNodeId ?? '' },
        inputMode: 'aiReference',
      })
      useReferencePreviewStore.getState().openPreview({
        docId: id,
        cardPath: resolution.cardPath,
        title: resolution.title || payload.title,
        type: resolution.type,
        nodeName: resolution.nodeName,
        sourceLabel: resolution.sourceLabel,
        ref: payload.ref,
        breadcrumb: payload.breadcrumb,
        blockLabel: payload.blockLabel,
        snippet: payload.snippet,
      })
      return true
    } catch (error) {
      toast({ level: 'error', title: '预览引用失败', message: (error as Error)?.message || String(error) })
      return false
    }
  }, [storage, selectedNodeId])

  /**
   * P5-r：把「按 docId 临时预览」注册成常驻引用桥。右栏详情面板是 CSS hidden
   * 常驻挂载的，不依赖 SmartDocumentEditor，因此 AI 回答里的 [ref:i] 即使画布
   * 没有选中节点也能打开预览。ref 保证回调始终是最新闭包，effect 只在 isActive
   * 变化时重注册；cleanup 只注销自己那一个，避免多 tab 之间互相清掉注册。
   */
  const openReferencePreviewRef = useRef(openReferencePreview)
  openReferencePreviewRef.current = openReferencePreview

  useEffect(() => {
    if (!isActive) return
    const handler = (payload: ReferenceOpenPayload) => openReferencePreviewRef.current(payload)
    setReferenceOpenHandler(handler)
    return () => clearReferenceOpenHandler(handler)
  }, [isActive])

  const backlinksTabContent = useMemo(() => (
    <DocumentRelationPanel
      incoming={incoming}
      outgoing={outgoing}
      loading={relationsLoading}
      parsed={parsed}
      indexed={indexed}
      onOpen={(docId) => { void openDocumentByDocId(docId) }}
      onRefresh={refreshRelations}
    />
  ), [incoming, outgoing, parsed, indexed, relationsLoading, openDocumentByDocId, refreshRelations])

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

  // ===== 传给 DocumentWorkspace 的回调必须保持引用稳定 =====
  // 内联箭头会让 DocumentSidebar 的 memo 与 useDocumentSidebarModel 里的整条
  // useCallback 链在每次父级渲染时失效，改一项样式就会重渲染整棵列表树。
  const selectDocumentForWorkspace = useCallback((documentPath: string) => {
    void handleSelectDocument(documentPath)
  }, [handleSelectDocument])
  const createTopoDocumentForWorkspace = useCallback((type: TopoDocumentType, name: string, parentId?: string | null) => {
    if (detailView === 'linked') {
      toast({ level: 'warn', title: '关联视图不新建文档', message: '请切换回「本节点文档」后新建' })
      return
    }
    void handleCreateTopoDocument(type, name, parentId)
  }, [detailView, handleCreateTopoDocument])
  const exportTopoDocumentForWorkspace = useCallback((documentPath: string) => {
    void handleExportTopoDocument(documentPath)
  }, [handleExportTopoDocument])
  const renameDocumentForWorkspace = useCallback((documentPath: string, name: string) => {
    void handleRenameDocument(documentPath, name)
  }, [handleRenameDocument])
  const deleteDocumentForWorkspace = useCallback((documentPath: string) => {
    void handleDeleteDocument(documentPath)
  }, [handleDeleteDocument])
  const moveDocumentForWorkspace = useCallback((documentId: string, newParentId: string | null, newSortOrder: number) => {
    void handleMoveDocument(documentId, newParentId, newSortOrder)
  }, [handleMoveDocument])
  const moveDocumentToCardForWorkspace = useCallback((documentId: string) => {
    setMoveToNode({ documentId })
  }, [])
  const updateDocumentMetaForWorkspace = useCallback((documentPath: string, patch: TopoDocumentMetaPatch) => {
    void handleUpdateDocumentMeta(documentPath, patch)
  }, [handleUpdateDocumentMeta])

  // ===== Empty state =====
  if (!selectedNodeId || !hasSelectedNode) {
    return (
      <div id="detail-panel" className="relative w-full flex-1 flex flex-col min-h-0 min-w-0 bg-[var(--color-surface)] shrink-0 overflow-hidden transition-opacity">
        <button
          type="button"
          className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--color-text-muted)] bg-transparent transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] ${
            isRightPanelPinned ? '!bg-[var(--color-accent-soft)] !text-[var(--color-accent)]' : ''
          }`}
          onClick={toggleRightPanelPinned}
          title={isRightPanelPinned ? '已固定右侧面板（点击取消固定）' : '固定右侧面板（不随节点/画布点击自动折叠）'}
          aria-label={isRightPanelPinned ? '取消固定右侧面板' : '固定右侧面板'}
          data-tm-right-panel-pin={isRightPanelPinned ? 'true' : 'false'}
        >
          {isRightPanelPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
        {lockedTarget && (
          <button
            type="button"
            className="absolute left-2 top-10 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--color-accent)] bg-[var(--color-accent-soft)] transition-colors hover:bg-[var(--color-hover-bg)]"
            onClick={() => unlock(kbPath)}
            title={`已锁定节点${nodeLabel ? `：${nodeLabel}` : ''}（点击解锁）`}
            aria-label="解锁节点"
            data-tm-detail-unlock-empty="true"
          >
            <Lock className="h-4 w-4" />
          </button>
        )}
        <div className="p-4 text-xs text-[var(--color-text-muted)] text-center mt-[40%]">
          {lockedTarget ? `已锁定节点${nodeLabel ? `：${nodeLabel}` : ''}，点击左上角解锁` : '选择一个节点查看详情'}
        </div>
      </div>
    )
  }

  return (
    <div id="detail-panel" className="w-full flex-1 flex flex-col min-h-0 min-w-0 bg-[var(--color-surface)] shrink-0 overflow-hidden transition-opacity">
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
                      {activeTopoDocumentId && (
                        <button
                          type="button"
                          data-tm-backlinks-header=""
                          className={`shrink-0 p-1 rounded hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)] cursor-pointer border-none bg-transparent flex items-center justify-center transition-opacity ${
                            detailSidebarTab === 'backlinks' && !detailSidebarCollapsed
                              ? 'opacity-100 text-[var(--color-primary)]'
                              : 'opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)]'
                          }`}
                          title="引用关系：查看谁引用了本页，以及本页引用了谁"
                          aria-label="引用关系"
                          onClick={() => {
                            setDetailSidebarTabSafe('backlinks')
                            handleDetailSidebarCollapsedChange(false)
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5" />
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
          backlinksTabContent={backlinksTabContent}
          topoDocuments={topoDocuments}
          activeDocumentPath={activeDocumentPath}
          detailSidebarTab={detailSidebarTab}
          onDetailSidebarTabChange={setDetailSidebarTabSafe}
          onSelectDocument={selectDocumentForWorkspace}
          onOpenDocumentByDocId={(docId: string) => { void openDocumentByDocId(docId) }}
          onCreateTopoDocument={createTopoDocumentForWorkspace}
          onExportTopoDocument={exportTopoDocumentForWorkspace}
          onRenameDocument={renameDocumentForWorkspace}
          onDeleteDocument={deleteDocumentForWorkspace}
          onMoveDocument={moveDocumentForWorkspace}
          onMoveDocumentToCard={moveDocumentToCardForWorkspace}
          onUpdateDocumentMeta={updateDocumentMetaForWorkspace}
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
