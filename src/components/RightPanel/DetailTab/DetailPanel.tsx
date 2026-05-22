/**
 * 右侧详情面板
 * 显示节点 Markdown 内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef, memo, useCallback, useMemo } from 'react'
import { useStorage, type DetailDocumentItem } from '../../../core/storage'
import { useRightPanelStore } from '../../../stores/rightPanelStore'
import { useConfirmStore } from '../../../stores/confirmStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useGraphStore, useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { MarkdownWorkspace } from '../../MarkdownWorkspace/MarkdownWorkspace'
import type { MarkdownViewMode } from '../../MarkdownWorkspace/markdownTypes'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { logger } from '../../../core/logger'
import { registerTabSaver } from '../../../core/close-guard'
import { tabStore } from '../../../stores/tabStore'
import { joinRefs, resolveRoomChildRef } from '../../../domain/graph/path-utils'

interface DetailPanelProps {
  tabId: string
}

const DEFAULT_DETAIL_DOCUMENT_PATH = '_content.md'

const DetailPanel = memo(function DetailPanel({ tabId }: DetailPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storeApi = useGraphStoreApi()
  const storage = useStorage()
  const collapseRightPanel = useRightPanelStore((s) => s.collapseRightPanel)
  const graph = useGraphContext()
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

  const [activeDocumentPath, setActiveDocumentPath] = useState(DEFAULT_DETAIL_DOCUMENT_PATH)
  const currentDocumentKey = nodePath ? joinRefs(nodePath, activeDocumentPath) : ''

  const draftMarkdown = useDraftStore((s) => currentDocumentKey ? (s.detailDrafts[currentDocumentKey] ?? '') : '')
  const setDraftMarkdown = useDraftStore((s) => s.setDetailDraft)
  const clearDetailDraft = useDraftStore((s) => s.clearDetailDraft)
  const detailEntry = useCardContentStore((s) => currentDocumentKey ? s.detailEntries[currentDocumentKey] : undefined)
  const setDetailMarkdown = useCardContentStore((s) => s.setDetailMarkdown)
  const clearDetailMarkdown = useCardContentStore((s) => s.clearDetailMarkdown)
  const setCardMarkdown = useCardContentStore((s) => s.setCardMarkdown)

  const [savedMarkdown, setSavedMarkdown] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [documents, setDocuments] = useState<DetailDocumentItem[]>([])
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')
  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('topomind_detail_sidebar_collapsed')
    return saved ? saved === 'true' : true
  })
  const [isSidebarHovered, setIsSidebarHovered] = useState(false)
  const [isButtonHovered, setIsButtonHovered] = useState(false)
  
  const hoverTimeoutRef = useRef<number | null>(null)
  const handleButtonHover = useCallback((hovered: boolean) => {
    if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current)
    if (hovered) {
      setIsButtonHovered(true)
    } else {
      hoverTimeoutRef.current = window.setTimeout(() => setIsButtonHovered(false), 150)
    }
  }, [])
  const handleSidebarHover = useCallback((hovered: boolean) => {
    if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current)
    if (hovered) {
      setIsSidebarHovered(true)
    } else {
      hoverTimeoutRef.current = window.setTimeout(() => {
        setIsSidebarHovered(false)
        setIsButtonHovered(false)
      }, 150)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const [viewMode, setViewMode] = useState<MarkdownViewMode>('preview')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const markdownRequestSeqRef = useRef(0)
  const selectionPerfRef = useRef<{ nodeId: string; startedAt: number; logged: boolean } | null>(null)

  const isDefaultDocument = activeDocumentPath === DEFAULT_DETAIL_DOCUMENT_PATH
  const displayDocuments = useMemo<DetailDocumentItem[]>(() => (
    documents.map((item) => {
      if (item.isDefault) {
        return { ...item, name: '详情' }
      }
      if (item.isCard) {
        return { ...item, name: '卡片' }
      }
      return item
    })
  ), [documents])
  const activeDocument = displayDocuments.find((item) => item.path === activeDocumentPath)
  const activeDocumentDisplayName = activeDocument?.name ?? nodeLabel
  const currentDocumentDisplayPath = nodePath
    ? (isDefaultDocument ? nodePath : joinRefs(nodePath, activeDocumentDisplayName))
    : ''
  const canRenameNodeFromTitle = isDefaultDocument

  const loadDocuments = useCallback(async (cardPath: string) => {
    const nextDocuments = await storage.listDetailDocuments(cardPath)
    setDocuments(nextDocuments)
    setActiveDocumentPath((currentPath) => (
      nextDocuments.some((item) => item.path === currentPath)
        ? currentPath
        : DEFAULT_DETAIL_DOCUMENT_PATH
    ))
    return nextDocuments
  }, [storage])

  // Load markdown when node changes
  useEffect(() => {
    setRenameMode(false)
    setNewName('')
    setActiveDocumentPath(DEFAULT_DETAIL_DOCUMENT_PATH)
    setDocuments([])
    setSavedMarkdown('')
    setViewMode('preview')

    if (!selectedNodeId || !nodePath) return
    void loadDocuments(nodePath)
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
    const requestSeq = ++markdownRequestSeqRef.current
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const readStartedAt = performance.now()

    const cachedContent = useCardContentStore.getState().detailEntries[currentDocumentKey]?.content
    if (cachedContent !== undefined) {
      setSavedMarkdown(cachedContent)
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, cachedContent)
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

    storage.readDetailDocument(nodePath, activeDocumentPath).then((content: string) => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: content.length,
      }, 'DetailPanel')
      setDetailMarkdown(currentDocumentKey, content)
      setSavedMarkdown(content)
      
      // 同步给 KnowledgeCard
      if (activeDocumentPath === '_card.md') {
        setCardMarkdown(nodePath, content)
      } else if (activeDocumentPath === DEFAULT_DETAIL_DOCUMENT_PATH) {
        setDetailMarkdown(nodePath, content)
      }
      
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, content)
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
      if (markdownRequestSeqRef.current !== requestSeq) return
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: false,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
      }, 'DetailPanel')
      setDetailMarkdown(currentDocumentKey, '')
      setSavedMarkdown('')
      
      if (activeDocumentPath === '_card.md') {
        setCardMarkdown(nodePath, '')
      } else if (activeDocumentPath === DEFAULT_DETAIL_DOCUMENT_PATH) {
        setDetailMarkdown(nodePath, '')
      }
      
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, '')
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
  }, [selectedNodeId, nodePath, activeDocumentPath, currentDocumentKey, storage, setDraftMarkdown, setDetailMarkdown, setCardMarkdown])

  useEffect(() => {
    if (detailEntry) {
      setSavedMarkdown(detailEntry.content)
    }
  }, [detailEntry])

  useEffect(() => {
    if (!documentLinkNotice) return
    const timeoutId = window.setTimeout(() => {
      setDocumentLinkNotice('')
    }, 2600)
    return () => window.clearTimeout(timeoutId)
  }, [documentLinkNotice])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renameMode && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renameMode])

  useEffect(() => {
    if (!canRenameNodeFromTitle && renameMode) {
      setRenameMode(false)
      setNewName('')
    }
  }, [canRenameNodeFromTitle, renameMode])

  // ===== Save markdown =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    const saveStartedAt = performance.now()
    try {
      await storage.writeDetailDocument(nodePath, activeDocumentPath, draftMarkdown)
      setDetailMarkdown(currentDocumentKey, draftMarkdown)
      setSavedMarkdown(draftMarkdown)
      
      // 同步更新给 KnowledgeCard 节点用
      if (activeDocumentPath === '_card.md') {
        setCardMarkdown(nodePath, draftMarkdown)
      } else if (activeDocumentPath === DEFAULT_DETAIL_DOCUMENT_PATH) {
        setDetailMarkdown(nodePath, draftMarkdown)
      }
      
      logAction('内容:保存', 'DetailPanel', { nodePath, documentPath: activeDocumentPath, label })
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: draftMarkdown.length,
      }, 'DetailPanel')
    } catch (e) {
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: false,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: draftMarkdown.length,
        error: e instanceof Error ? e.message : String(e),
      }, 'DetailPanel')
      logger.catch('DetailPanel', 'handleSave', e)
    }
  }, [selectedNodeId, nodePath, currentDocumentKey, storeApi, storage, draftMarkdown, setDetailMarkdown, setCardMarkdown, activeDocumentPath])

  // ===== Rename node =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleRenameConfirm = () => {
    if (!renameMode || !newName.trim() || !selectedNodeId) {
      setRenameMode(false)
      return
    }
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const oldLabel = node?.data.label ?? nodeLabel
    const path = resolveNodePath(selectedNodeId)
    logAction('节点:重命名', 'DetailPanel', {
      nodeId: selectedNodeId,
      oldName: oldLabel,
      newName: newName.trim(),
      path,
    })
    graph.renameNode(selectedNodeId, newName.trim())
    setRenameMode(false)
  }

  // ===== Delete detail =====
  // Use nodesMapRef for stale-closure-safe node data access.
  const flushMarkdownSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    if (draftMarkdown === savedMarkdown) return
    await handleSave()
  }, [selectedNodeId, nodePath, currentDocumentKey, draftMarkdown, savedMarkdown, handleSave])

  const handleSelectDetailDocument = useCallback(async (documentPath: string) => {
    if (documentPath === activeDocumentPath) return
    await flushMarkdownSave()
    setActiveDocumentPath(documentPath)
  }, [activeDocumentPath, flushMarkdownSave])

  const handleOpenDetailDocumentLink = useCallback(async (documentPath: string) => {
    if (!nodePath) return
    const nextDocuments = await loadDocuments(nodePath)
    if (!nextDocuments.some((item) => item.path === documentPath)) {
      setDocumentLinkNotice(`未找到文档：${documentPath}`)
      return
    }
    setDocumentLinkNotice('')
    await handleSelectDetailDocument(documentPath)
  }, [handleSelectDetailDocument, loadDocuments, nodePath])

  const handleCreateDetailDocument = useCallback(async (name: string) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    setIsDocumentBusy(true)
    try {
      await flushMarkdownSave()
      const created = await storage.createDetailDocument(nodePath, nextName)
      const createdDocumentKey = joinRefs(nodePath, created.path)
      clearDetailDraft(createdDocumentKey)
      clearDetailMarkdown(createdDocumentKey)
      await loadDocuments(nodePath)
      setActiveDocumentPath(created.path)
      logAction('详情文档:创建', 'DetailPanel', { nodePath, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', 'handleCreateDetailDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushMarkdownSave, storage, clearDetailDraft, clearDetailMarkdown, loadDocuments])

  const handleRenameDetailDocument = useCallback(async (documentPath: string, name: string) => {
    if (!nodePath || documentPath === DEFAULT_DETAIL_DOCUMENT_PATH) return
    const nextName = name.trim()
    if (!nextName) return
    const targetDocument = documents.find((item) => item.path === documentPath)
    if (targetDocument?.name === nextName) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushMarkdownSave()
      }
      const previousDocumentKey = joinRefs(nodePath, documentPath)
      const renamed = await storage.renameDetailDocument(nodePath, documentPath, nextName.trim())
      clearDetailDraft(previousDocumentKey)
      clearDetailMarkdown(previousDocumentKey)
      await loadDocuments(nodePath)
      if (activeDocumentPath === documentPath) {
        setActiveDocumentPath(renamed.path)
      }
      logAction('详情文档:重命名', 'DetailPanel', { nodePath, documentPath, nextDocumentPath: renamed.path })
    } catch (e) {
      logger.catch('DetailPanel', 'handleRenameDetailDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, documents, activeDocumentPath, flushMarkdownSave, storage, clearDetailDraft, clearDetailMarkdown, loadDocuments])

  const handleDeleteDetail = useCallback(async (documentPath = activeDocumentPath) => {
    if (!selectedNodeId || !nodePath || documentPath === DEFAULT_DETAIL_DOCUMENT_PATH) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label ?? selectedNodeId
    const targetDocument = documents.find((item) => item.path === documentPath)
    const confirmed = await confirm({
      title: '删除文档',
      message: `将删除节点「${label}」的文档「${targetDocument?.name ?? documentPath}」。此操作不可撤销。`
    })
    if (!confirmed) return
    setIsDocumentBusy(true)
    try {
      const documentKey = joinRefs(nodePath, documentPath)
      if (documentPath === activeDocumentPath) {
        setActiveDocumentPath(DEFAULT_DETAIL_DOCUMENT_PATH)
      }
      await storage.deleteDetailDocument(nodePath, documentPath)
      clearDetailDraft(documentKey)
      clearDetailMarkdown(documentKey)
      await loadDocuments(nodePath)
      logAction('详情文档:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path: nodePath, documentPath })
    } catch (e) {
      logger.catch('DetailPanel', 'handleDeleteDetail', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, clearDetailDraft, clearDetailMarkdown, confirm, documents, loadDocuments, nodePath, selectedNodeId, storeApi])

  useEffect(() => {
    return registerTabSaver(tabId, flushMarkdownSave)
  }, [tabId, flushMarkdownSave])

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
        <MarkdownWorkspace
          value={draftMarkdown}
          savedValue={savedMarkdown}
          onChange={(val) => currentDocumentKey && setDraftMarkdown(currentDocumentKey, val)}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          documentType="detail"
          previewClassName="text-[15px] leading-relaxed text-[var(--color-text-primary)] [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_p]:mt-0 [&_p]:mb-2.5 [&_blockquote]:mt-0 [&_blockquote]:mb-4 [&_ul]:mt-0 [&_ul]:mb-4 [&_ol]:mt-0 [&_ol]:mb-4 [&_dl]:mt-0 [&_dl]:mb-4 [&_table]:mt-0 [&_table]:mb-4 [&_pre]:mt-0 [&_pre]:mb-4 [&_details]:mt-0 [&_details]:mb-4 [&_img]:rounded-md"
          detailSidebarCollapsed={detailSidebarCollapsed}
          detailSidebarFloating={detailSidebarCollapsed && (isSidebarHovered || isButtonHovered)}
          onDetailSidebarCollapsedChange={handleToggleSidebar}
          onSidebarHoverChange={handleSidebarHover}
          detailHeader={(
            <div className="min-h-[58px] px-4 pt-2.5 pb-2 border-b border-[var(--color-border-light)] shrink-0 flex flex-col justify-center gap-1 bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] box-border">
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    className="w-6 h-6 inline-flex items-center justify-center shrink-0 p-0 border border-[var(--color-border)] rounded-[7px] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] text-[var(--color-text-muted)] cursor-pointer shadow-[var(--shadow-sm)] transition-all hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-primary)] hover:shadow-[var(--shadow-md)] active:shadow-[var(--shadow-sm)]"
                    onClick={handleToggleSidebar}
                    onMouseEnter={() => handleButtonHover(true)}
                    onMouseLeave={() => handleButtonHover(false)}
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
                      {renameMode ? (
                        <input
                          ref={renameInputRef}
                          className="min-h-[calc(1em*1.3+10px)] py-1 px-2.5 border border-transparent rounded-lg font-inherit leading-tight text-inherit outline-none w-full box-border bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] shadow-none transition-all focus:bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[var(--color-border)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onBlur={handleRenameConfirm}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameConfirm()
                            if (e.key === 'Escape') setRenameMode(false)
                          }}
                        />
                      ) : (
                        <span
                          className="text-base font-bold text-[var(--color-primary)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                          title={currentDocumentDisplayPath || undefined}
                          onDoubleClick={() => {
                            if (!canRenameNodeFromTitle) return
                            setNewName(nodeLabel)
                            setRenameMode(true)
                          }}
                          style={{ cursor: canRenameNodeFromTitle ? 'pointer' : 'default' }}
                        >
                          {activeDocumentDisplayName}
                        </span>
                      )}
                      {childCount > 0 && (
                        <span className="py-0.5 px-[7px] rounded-[10px] bg-[var(--color-hover-bg)] text-[10px] text-[var(--color-text-muted)] shrink-0" title="含有子概念">
                          {childCount} 子
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-medium text-[var(--color-text-muted)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{currentDocumentDisplayPath}</div>
                  </div>
                </div>
                <div className="flex items-center p-0.5 border border-[var(--color-border)] rounded-[9px] bg-[var(--color-bg-muted)] shrink-0">
                  <button
                    type="button"
                    className={`h-7 px-3 border-none rounded-[7px] bg-transparent text-[12px] font-semibold cursor-pointer transition-all hover:text-[var(--color-primary)] ${viewMode === 'edit' ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--color-text-muted)]'}`}
                    onClick={() => setViewMode('edit')}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className={`h-7 px-3 border-none rounded-[7px] bg-transparent text-[12px] font-semibold cursor-pointer transition-all hover:text-[var(--color-primary)] ${viewMode === 'preview' ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--color-text-muted)]'}`}
                    onClick={() => setViewMode('preview')}
                  >
                    预览
                  </button>
                </div>
              </div>
              {documentLinkNotice && (
                <div className="mt-0.5 py-1.5 px-2.5 border border-[var(--color-warning-border)] rounded-lg bg-[var(--color-warning-soft)] text-[var(--color-warning)] text-xs leading-snug" role="status">
                  {documentLinkNotice}
                </div>
              )}
            </div>
          )}
          detailDocuments={displayDocuments}
          activeDetailDocumentPath={activeDocumentPath}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showToolbar={false}
          onSelectDetailDocument={(documentPath) => { void handleSelectDetailDocument(documentPath) }}
          onOpenDetailDocumentLink={(documentPath) => { void handleOpenDetailDocumentLink(documentPath) }}
          onCreateDetailDocument={(name) => { void handleCreateDetailDocument(name) }}
          onRenameDetailDocument={(documentPath, name) => { void handleRenameDetailDocument(documentPath, name) }}
          onDeleteDetailDocument={(documentPath) => { void handleDeleteDetail(documentPath) }}
          isDetailDocumentBusy={isDocumentBusy}
        />
      </div>
    </div>
  )
})

export default DetailPanel
