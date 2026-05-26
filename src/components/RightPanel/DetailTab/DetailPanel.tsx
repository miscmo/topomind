/**
 * 右侧详情面板
 * 显示节点 文档内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef, memo, useCallback, useMemo } from 'react'
import { useStorage } from '../../../core/storage'
import { useConfirmStore } from '../../../stores/confirmStore'
import { useGraphStore, useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { DocumentWorkspace } from '../../DocumentWorkspace/DocumentWorkspace'
import type { TopoDocumentManifestItem } from '../../../core/storage'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { logger } from '../../../core/logger'
import { registerTabSaver } from '../../../core/close-guard'
import { tabStore } from '../../../stores/tabStore'
import { joinRefs, resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { isTopoDocumentPath, topoDocumentIdFromPath, topoDocumentPath } from '../../DocumentWorkspace/documentTypes'

interface DetailPanelProps {
  tabId: string
}

const DetailPanel = memo(function DetailPanel({ tabId }: DetailPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storeApi = useGraphStoreApi()
  const storage = useStorage()
  const confirm = useConfirmStore((s) => s.open)

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

  const draftContent = useDraftStore((s) => currentDocumentKey ? (s.detailDrafts[currentDocumentKey] ?? '') : '')
  const setDraftContent = useDraftStore((s) => s.setDetailDraft)
  const clearDetailDraft = useDraftStore((s) => s.clearDetailDraft)
  const detailEntry = useCardContentStore((s) => currentDocumentKey ? s.detailEntries[currentDocumentKey] : undefined)
  const setDetailContent = useCardContentStore((s) => s.setDetailContent)
  const clearDetailContent = useCardContentStore((s) => s.clearDetailContent)

  const [savedContent, setSavedContent] = useState('')
  const [topoDocuments, setTopoDocuments] = useState<TopoDocumentManifestItem[]>([])
  const [topoDocumentsCardPath, setTopoDocumentsCardPath] = useState('')
  const [loadedDocumentKey, setLoadedDocumentKey] = useState('')
  
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

  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')
  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('topomind_detail_sidebar_collapsed')
    return saved ? saved === 'true' : true
  })
  const [isPanelHovered, setIsPanelHovered] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleHoverEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setIsPanelHovered(true)
  }, [])

  const handleHoverLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsPanelHovered(false)
    }, 150)
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const contentRequestSeqRef = useRef(0)
  const documentListRequestSeqRef = useRef(0)
  const selectionPerfRef = useRef<{ nodeId: string; startedAt: number; logged: boolean } | null>(null)
  const currentTopoDocuments = nodePath && topoDocumentsCardPath === nodePath ? topoDocuments : []
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDocumentPath)
  const activeTopoDocument = activeTopoDocumentId
    ? currentTopoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
  const isActiveTopoDocument = isTopoDocumentPath(activeDocumentPath)
  const activeStructuredTopoDocumentId = (activeTopoDocument?.type === 'smart' || activeTopoDocument?.type === 'mindmap' || activeTopoDocument?.type === 'flowchart') ? activeTopoDocument.id : null
  const isActiveStructuredTopoDocument = activeStructuredTopoDocumentId != null

  const activeEditableTopoDocumentId = activeStructuredTopoDocumentId
  const isActiveEditableTopoDocument = Boolean(activeEditableTopoDocumentId)

  const activeDocumentDisplayName = activeTopoDocument?.title ?? ''
  const currentDocumentDisplayPath = nodePath
    ? (activeTopoDocument ? joinRefs(nodePath, `_docs/${activeTopoDocument.path}`) : '')
    : ''

  const loadDocuments = useCallback(async (cardPath: string, requestSeq?: number) => {
    const nextTopoDocuments = await storage.listTopoDocuments(cardPath).catch((e) => {
      logger.catch('DetailPanel', `loadTopoDocuments: ${cardPath}`, e)
      return [] as TopoDocumentManifestItem[]
    })
    if (requestSeq !== undefined && documentListRequestSeqRef.current !== requestSeq) {
      return nextTopoDocuments
    }
    setTopoDocuments(nextTopoDocuments)
    setTopoDocumentsCardPath(cardPath)
    
    // Default to the first available document if the active one doesn't exist anymore
    setActiveDocumentPath((currentPath) => {
      // Always favor existing topo documents, default to first available
      if (nextTopoDocuments.some((item) => topoDocumentPath(item.id) === currentPath)) {
        return currentPath
      }
      return nextTopoDocuments.length > 0 ? topoDocumentPath(nextTopoDocuments[0].id) : ''
    })
    return nextTopoDocuments
  }, [storage])

  useEffect(() => {
    const requestSeq = ++documentListRequestSeqRef.current
    // When node changes, reset state
    setActiveDocumentPath('')
    setTopoDocuments([])
    setTopoDocumentsCardPath('')
    setSavedContent('')

    if (!selectedNodeId || !nodePath) return
    
    // After loading, ensure active path is set to the first document if available
    void loadDocuments(nodePath, requestSeq).then((docs) => {
      if (documentListRequestSeqRef.current !== requestSeq) return
      if (docs.length > 0) {
        setActiveDocumentPath(topoDocumentPath(docs[0].id))
      }
    })
  }, [selectedNodeId, nodePath, loadDocuments])

  useEffect(() => {
    if (!selectedNodeId) {
      selectionPerfRef.current = null
      return
    }
    const startedAt = takePerformanceMetricStart(PERFORMANCE_METRICS.nodeSelect, selectedNodeId) ?? performance.now()
    selectionPerfRef.current = {
      nodeId: selectedNodeId,
      startedAt,
      logged: false,
    }
  }, [selectedNodeId])

  useEffect(() => {
    const requestSeq = ++contentRequestSeqRef.current
    setLoadedDocumentKey('')
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const readStartedAt = performance.now()

    const cachedContent = useCardContentStore.getState().detailEntries[currentDocumentKey]?.content
    if (cachedContent !== undefined) {
      setSavedContent(cachedContent)
      setLoadedDocumentKey(currentDocumentKey)
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftContent(currentDocumentKey, cachedContent)
      }
      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: true,
          nodeId: selectedNodeId,
          nodePath,
          documentPath: activeDocumentPath,
          cacheHit: true,
        }, 'DetailPanel')
      }
    }

    const readPromise = activeEditableTopoDocumentId
      ? storage.readTopoDocument(nodePath, activeEditableTopoDocumentId).then((content) => typeof content === 'string' ? content : JSON.stringify(content ?? null, null, 2))
      : Promise.resolve('')

    readPromise.then((content: string) => {
      if (contentRequestSeqRef.current !== requestSeq) return
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: content.length,
      }, 'DetailPanel')
      setDetailContent(currentDocumentKey, content)
      setSavedContent(content)
      setLoadedDocumentKey(currentDocumentKey)
      
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftContent(currentDocumentKey, content)
      }
      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: true,
          nodeId: selectedNodeId,
          nodePath,
          documentPath: activeDocumentPath,
          cacheHit: false,
          contentLength: content.length,
        }, 'DetailPanel')
      }
    }).catch(() => {
      if (contentRequestSeqRef.current !== requestSeq) return
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: false,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
      }, 'DetailPanel')
      setDetailContent(currentDocumentKey, '')
      setSavedContent('')
      setLoadedDocumentKey(currentDocumentKey)
      
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftContent(currentDocumentKey, '')
      }
      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: false,
          nodeId: selectedNodeId,
          nodePath,
          documentPath: activeDocumentPath,
        }, 'DetailPanel')
      }
    })
  }, [selectedNodeId, nodePath, activeDocumentPath, currentDocumentKey, activeEditableTopoDocumentId, isActiveEditableTopoDocument, storage, setDraftContent, setDetailContent])

  useEffect(() => {
    if (activeDocumentPath !== '' && detailEntry) {
      setSavedContent(detailEntry.content)
    }
  }, [detailEntry, activeDocumentPath])

  useEffect(() => {
    if (!documentLinkNotice) return
    const timeoutId = window.setTimeout(() => {
      setDocumentLinkNotice('')
    }, 2600)
    return () => window.clearTimeout(timeoutId)
  }, [documentLinkNotice])

  // ===== Save document =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    const saveStartedAt = performance.now()
    try {
      if (activeEditableTopoDocumentId) {
        await storage.writeTopoDocument(nodePath, activeEditableTopoDocumentId, activeStructuredTopoDocumentId ? JSON.parse(draftContent || 'null') : draftContent)
      }
      setDetailContent(currentDocumentKey, draftContent)
      setSavedContent(draftContent)
      
      logAction('内容:保存', 'DetailPanel', { nodePath, documentPath: activeDocumentPath, label })
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: draftContent.length,
      }, 'DetailPanel')
    } catch (e) {
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: false,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: draftContent.length,
        error: e instanceof Error ? e.message : String(e),
      }, 'DetailPanel')
      logger.catch('DetailPanel', 'handleSave', e)
      throw e
    }
  }, [isActiveEditableTopoDocument, activeEditableTopoDocumentId, activeStructuredTopoDocumentId, selectedNodeId, nodePath, currentDocumentKey, storeApi, storage, draftContent, setDetailContent, activeDocumentPath])

  // ===== Delete detail =====
  // Use nodesMapRef for stale-closure-safe node data access.
  const flushDocumentSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    if (draftContent === savedContent) return
    await handleSave()
  }, [selectedNodeId, nodePath, currentDocumentKey, draftContent, savedContent, handleSave])

  const handleSelectDocument = useCallback(async (documentPath: string) => {
    if (documentPath === activeDocumentPath) return
    try {
      await flushDocumentSave()
      setActiveDocumentPath(documentPath)
    } catch (e) {
      setDocumentLinkNotice('保存当前文档失败，已取消切换。')
      logger.catch('DetailPanel', 'handleSelectDocument', e)
    }
  }, [activeDocumentPath, flushDocumentSave])

  const handleOpenDetailDocumentLink = useCallback(async (documentPath: string) => {
    if (!nodePath) return
    const nextDocuments = await loadDocuments(nodePath)
    if (!nextDocuments.some((item) => topoDocumentPath(item.id) === documentPath)) {
      setDocumentLinkNotice(`未找到文档：${documentPath}`)
      return
    }
    setDocumentLinkNotice('')
    await handleSelectDocument(documentPath)
  }, [handleSelectDocument, loadDocuments, nodePath])

  const handleCreateTopoSmartDocument = useCallback(async (name: string, parentId?: string | null) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await storage.createTopoDocument(nodePath, { type: 'smart', title: nextName, parentId: parentId || null })
      const createdDocumentPath = topoDocumentPath(created.id)
      const createdDocumentKey = joinRefs(nodePath, createdDocumentPath)
      clearDetailDraft(createdDocumentKey)
      clearDetailContent(createdDocumentKey)
      await loadDocuments(nodePath)
      setActiveDocumentPath(createdDocumentPath)
      logAction('多类型文档:创建智能文档', 'DetailPanel', { nodePath, documentId: created.id, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', 'handleCreateTopoSmartDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments])

  const handleCreateTopoMindMapDocument = useCallback(async (name: string, parentId?: string | null) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await storage.createTopoDocument(nodePath, { type: 'mindmap', title: nextName, parentId: parentId || null })
      const createdDocumentPath = topoDocumentPath(created.id)
      const createdDocumentKey = joinRefs(nodePath, createdDocumentPath)
      clearDetailDraft(createdDocumentKey)
      clearDetailContent(createdDocumentKey)
      await loadDocuments(nodePath)
      setActiveDocumentPath(createdDocumentPath)
      logAction('多类型文档:创建思维导图', 'DetailPanel', { nodePath, documentId: created.id, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', 'handleCreateTopoMindMapDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments])

  const handleCreateTopoFlowchartDocument = useCallback(async (name: string, parentId?: string | null) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await storage.createTopoDocument(nodePath, { type: 'flowchart', title: nextName, parentId: parentId || null })
      const createdDocumentPath = topoDocumentPath(created.id)
      const createdDocumentKey = joinRefs(nodePath, createdDocumentPath)
      clearDetailDraft(createdDocumentKey)
      clearDetailContent(createdDocumentKey)
      await loadDocuments(nodePath)
      setActiveDocumentPath(createdDocumentPath)
      logAction('多类型文档:创建流程图', 'DetailPanel', { nodePath, documentId: created.id, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', 'handleCreateTopoFlowchartDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments])

  const handleRenameDocument = useCallback(async (documentPath: string, name: string) => {
    if (!nodePath || documentPath === '') return
    const nextName = name.trim()
    if (!nextName) return
    const targetDocument = topoDocuments.find((item) => topoDocumentPath(item.id) === documentPath)
    if (targetDocument && 'title' in targetDocument && targetDocument.title === nextName) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushDocumentSave()
      }
      const previousDocumentKey = joinRefs(nodePath, documentPath)
      
      const documentId = topoDocumentIdFromPath(documentPath)
      if (!documentId) return
      await storage.renameTopoDocument(nodePath, documentId, nextName)

      clearDetailDraft(previousDocumentKey)
      clearDetailContent(previousDocumentKey)
      await loadDocuments(nodePath)
      logAction('文档:重命名', 'DetailPanel', { nodePath, documentPath, nextName })
    } catch (e) {
      logger.catch('DetailPanel', 'handleRenameDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, topoDocuments, activeDocumentPath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments])

  const handleDeleteDocument = useCallback(async (documentPath: string = activeDocumentPath) => {
    if (!selectedNodeId || !nodePath || documentPath === '') return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label ?? selectedNodeId
    const targetDocument = topoDocuments.find((item) => topoDocumentPath(item.id) === documentPath)
    const documentName = targetDocument ? targetDocument.title : documentPath
    const confirmed = await confirm({
      title: '删除文档',
      message: `将删除节点「${label}」的文档「${documentName}」。此操作不可撤销。`
    })
    if (!confirmed) return
    setIsDocumentBusy(true)
    try {
      const documentKey = joinRefs(nodePath, documentPath)
      if (documentPath === activeDocumentPath) {
        // optimistically clear path if we are deleting the active document
        setActiveDocumentPath('')
      }
      
      const documentId = topoDocumentIdFromPath(documentPath)
      if (!documentId) return
      await storage.deleteTopoDocument(nodePath, documentId)
      
      clearDetailDraft(documentKey)
      clearDetailContent(documentKey)
      
      const nextDocs = await loadDocuments(nodePath)
      if (documentPath === activeDocumentPath || activeDocumentPath === '') {
        setActiveDocumentPath(nextDocs.length > 0 ? topoDocumentPath(nextDocs[0].id) : '')
      }
      
      logAction('文档:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path: nodePath, documentPath })
    } catch (e) {
      logger.catch('DetailPanel', 'handleDeleteDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, clearDetailDraft, clearDetailContent, confirm, topoDocuments, loadDocuments, nodePath, selectedNodeId, storeApi, storage])

  const handleMoveDocument = useCallback(async (documentId: string, newParentId: string | null, newSortOrder: number) => {
    if (!nodePath) return
    setIsDocumentBusy(true)
    try {
      await storage.moveTopoDocument(nodePath, documentId, newParentId, newSortOrder)
      await loadDocuments(nodePath)
      logAction('文档:移动', 'DetailPanel', { nodePath, documentId, newParentId, newSortOrder })
    } catch (e) {
      logger.catch('DetailPanel', 'handleMoveDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, storage, loadDocuments])

  const handleExportTopoDocument = useCallback(async (documentPath: string) => {
    if (!nodePath) return
    const documentId = topoDocumentIdFromPath(documentPath)
    if (!documentId) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushDocumentSave()
      }
      const payload = await storage.exportTopoDocument(nodePath, documentId)
      const blob = new Blob([payload.content], { type: payload.mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = payload.fileName
      try {
        document.body.appendChild(anchor)
        anchor.click()
      } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      logAction('多类型文档:导出', 'DetailPanel', { nodePath, documentId, fileName: payload.fileName, type: payload.type })
    } catch (e) {
      logger.catch('DetailPanel', 'handleExportTopoDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, flushDocumentSave, nodePath, storage])

  const handleOpenCurrentDocumentFolder = useCallback(async () => {
    if (!nodePath || !activeTopoDocumentId) return
    setDocumentLinkNotice('')
    try {
      await flushDocumentSave()
      const opened = await storage.openTopoDocumentFolder(nodePath, activeTopoDocumentId)
      if (!opened) {
        setDocumentLinkNotice('无法打开当前文档所在目录')
      }
    } catch (e) {
      setDocumentLinkNotice('打开当前文档所在目录失败')
      logger.catch('DetailPanel', 'handleOpenCurrentDocumentFolder', e)
    }
  }, [activeTopoDocumentId, flushDocumentSave, nodePath, storage])

  useEffect(() => {
    return registerTabSaver(tabId, flushDocumentSave, () => draftContent !== savedContent)
  }, [tabId, flushDocumentSave, draftContent, savedContent])

  const handleToggleSidebar = useCallback(() => {
    setDetailSidebarCollapsed((collapsed) => {
      const next = !collapsed
      localStorage.setItem('topomind_detail_sidebar_collapsed', String(next))
      return next
    })
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
          savedValue={savedContent}
          isContentLoaded={loadedDocumentKey === currentDocumentKey}
          onChange={(val: string) => currentDocumentKey && setDraftContent(currentDocumentKey, val)}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          detailSidebarCollapsed={detailSidebarCollapsed}
          detailSidebarFloating={detailSidebarCollapsed && isPanelHovered}
          onDetailSidebarCollapsedChange={handleToggleSidebar}
          onSidebarHoverChange={(hovered: boolean) => hovered ? handleHoverEnter() : handleHoverLeave()}
          detailHeader={(
            <div className="min-h-[58px] px-4 pt-2.5 pb-2 border-b border-[var(--color-border-light)] shrink-0 flex flex-col justify-center gap-1 bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] box-border">
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    className="w-6 h-6 inline-flex items-center justify-center shrink-0 p-0 border border-[var(--color-border)] rounded-[7px] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] text-[var(--color-text-muted)] cursor-pointer shadow-[var(--shadow-sm)] transition-all hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-primary)] hover:shadow-[var(--shadow-md)] active:shadow-[var(--shadow-sm)]"
                    onClick={handleToggleSidebar}
                    onMouseEnter={handleHoverEnter}
                    onMouseLeave={handleHoverLeave}
                    title={detailSidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
                    aria-label={detailSidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
                  >
                    <span className="relative w-3 h-3 inline-block" aria-hidden="true">
                      <span className="absolute left-0 w-3 h-[1.5px] rounded-full bg-current opacity-90 top-[1px]" />
                      <span className="absolute left-0 w-3 h-[1.5px] rounded-full bg-current opacity-90 top-[5px]" />
                      <span className="absolute left-0 w-3 h-[1.5px] rounded-full bg-current opacity-90 top-[9px]" />
                      <span
                        className={`absolute top-1 right-[-1px] w-0 h-0 border-y-[3px] border-y-transparent ${
                          detailSidebarCollapsed
                            ? 'border-l-[4px] border-l-current'
                            : 'border-r-[4px] border-r-current'
                        }`}
                      />
                    </span>
                  </button>
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
                        onClick={() => { void handleOpenCurrentDocumentFolder() }}
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
          activeDocumentPath={activeDocumentPath}
          onSelectDocument={(documentPath: string) => { void handleSelectDocument(documentPath) }}
          onOpenDetailDocumentLink={(documentPath: string) => { void handleOpenDetailDocumentLink(documentPath) }}
          onCreateTopoSmartDocument={(name: string, parentId?: string | null) => { void handleCreateTopoSmartDocument(name, parentId) }}
          onCreateTopoMindMapDocument={(name: string, parentId?: string | null) => { void handleCreateTopoMindMapDocument(name, parentId) }}
          onCreateTopoFlowchartDocument={(name: string, parentId?: string | null) => { void handleCreateTopoFlowchartDocument(name, parentId) }}
          onExportTopoDocument={(documentPath: string) => { void handleExportTopoDocument(documentPath) }}
          onRenameDocument={(documentPath: string, name: string) => { void handleRenameDocument(documentPath, name) }}
          onDeleteDocument={(documentPath: string) => { void handleDeleteDocument(documentPath) }}
          onMoveDocument={(documentId: string, newParentId: string | null, newSortOrder: number) => { void handleMoveDocument(documentId, newParentId, newSortOrder) }}
          isDocumentBusy={isDocumentBusy}
        />
      </div>
    </div>
  )
})

export default DetailPanel
