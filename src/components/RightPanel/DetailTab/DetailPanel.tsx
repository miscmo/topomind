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
import styles from './DetailTab.module.css'
import { logAction } from '../../../core/log-backend'
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

  const selectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId) : null)
  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null
  const [activeDocumentPath, setActiveDocumentPath] = useState(DEFAULT_DETAIL_DOCUMENT_PATH)
  const currentDocumentKey = nodePath ? joinRefs(nodePath, activeDocumentPath) : ''

  const draftMarkdown = useDraftStore((s) => currentDocumentKey ? (s.detailDrafts[currentDocumentKey] ?? '') : '')
  const setDraftMarkdown = useDraftStore((s) => s.setDetailDraft)
  const clearDetailDraft = useDraftStore((s) => s.clearDetailDraft)
  const detailEntry = useCardContentStore((s) => currentDocumentKey ? s.detailEntries[currentDocumentKey] : undefined)
  const setDetailMarkdown = useCardContentStore((s) => s.setDetailMarkdown)
  const clearDetailMarkdown = useCardContentStore((s) => s.clearDetailMarkdown)

  const [savedMarkdown, setSavedMarkdown] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [documents, setDocuments] = useState<DetailDocumentItem[]>([])
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')
  const [detailSidebarCollapsed, setDetailSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('preview')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const markdownRequestSeqRef = useRef(0)

  const childCount = selectedNode?.data.childCount ?? 0
  const isDefaultDocument = activeDocumentPath === DEFAULT_DETAIL_DOCUMENT_PATH
  const nodeLabel = selectedNode?.data.label ?? ''
  const displayDocuments = useMemo<DetailDocumentItem[]>(() => (
    documents.map((item) => (
      item.isDefault
        ? { ...item, name: nodeLabel || item.name }
        : item
    ))
  ), [documents, nodeLabel])
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
    const requestSeq = ++markdownRequestSeqRef.current
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return

    const cachedContent = useCardContentStore.getState().detailEntries[currentDocumentKey]?.content
    if (cachedContent !== undefined) {
      setSavedMarkdown(cachedContent)
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, cachedContent)
      }
    }

    storage.readDetailDocument(nodePath, activeDocumentPath).then((content: string) => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setDetailMarkdown(currentDocumentKey, content)
      setSavedMarkdown(content)
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, content)
      }
    }).catch(() => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setDetailMarkdown(currentDocumentKey, '')
      setSavedMarkdown('')
      if (useDraftStore.getState().detailDrafts[currentDocumentKey] === undefined) {
        setDraftMarkdown(currentDocumentKey, '')
      }
    })
  }, [selectedNodeId, nodePath, activeDocumentPath, currentDocumentKey, storage, setDraftMarkdown, setDetailMarkdown])

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
    try {
      await storage.writeDetailDocument(nodePath, activeDocumentPath, draftMarkdown)
      setDetailMarkdown(currentDocumentKey, draftMarkdown)
      setSavedMarkdown(draftMarkdown)
      logAction('内容:保存', 'DetailPanel', { nodePath, documentPath: activeDocumentPath, label })
    } catch (e) {
      logger.catch('DetailPanel', 'handleSave', e)
    }
  }, [selectedNodeId, nodePath, currentDocumentKey, storeApi, storage, draftMarkdown, setDetailMarkdown, activeDocumentPath])

  // ===== Rename node =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleRenameConfirm = () => {
    if (!renameMode || !newName.trim() || !selectedNodeId) {
      setRenameMode(false)
      return
    }
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const oldLabel = node?.data.label ?? selectedNode?.data.label
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

  // ===== Empty state =====
  if (!selectedNodeId || !selectedNode) {
    return (
      <div id="detail-panel" className={styles.detailPanel}>
        <div className={styles.emptyState}>选择一个节点查看详情</div>
      </div>
    )
  }

  const { data } = selectedNode

  return (
    <div id="detail-panel" className={styles.detailPanel}>
      <div className={styles.body}>
        <MarkdownWorkspace
          value={draftMarkdown}
          savedValue={savedMarkdown}
          onChange={(val) => currentDocumentKey && setDraftMarkdown(currentDocumentKey, val)}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          documentType="detail"
          previewClassName={styles.markdownBody}
          detailHeader={(
            <div className={styles.title}>
              <div className={styles.titleMain}>
                <div className={styles.titleTextGroup}>
                  <button
                    type="button"
                    className={styles.sidebarToggleBtn}
                    onClick={() => setDetailSidebarCollapsed((collapsed) => !collapsed)}
                    title={detailSidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
                    aria-label={detailSidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
                  >
                    <span className={styles.sidebarToggleIcon} aria-hidden="true">
                      <span className={styles.sidebarToggleLine} />
                      <span className={styles.sidebarToggleLine} />
                      <span className={styles.sidebarToggleLine} />
                      <span
                        className={`${styles.sidebarToggleArrow} ${
                          detailSidebarCollapsed
                            ? styles.sidebarToggleArrowExpand
                            : styles.sidebarToggleArrowCollapse
                        }`}
                      />
                    </span>
                  </button>
                  <div className={styles.titleInfo}>
                    <div className={styles.titlePrimary}>
                      {renameMode ? (
                        <input
                          ref={renameInputRef}
                          className={styles.renameInput}
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
                          className={styles.titleText}
                          title={currentDocumentDisplayPath || undefined}
                          onDoubleClick={() => {
                            if (!canRenameNodeFromTitle) return
                            setNewName(data.label)
                            setRenameMode(true)
                          }}
                          style={{ cursor: canRenameNodeFromTitle ? 'pointer' : 'default' }}
                        >
                          {activeDocumentDisplayName}
                        </span>
                      )}
                      {childCount > 0 && (
                        <span className={styles.badge} title="含有子概念">
                          {childCount} 子
                        </span>
                      )}
                    </div>
                    <div className={styles.titleSub}>{currentDocumentDisplayPath}</div>
                  </div>
                </div>
                <div className={styles.viewSwitch}>
                  <button
                    type="button"
                    className={`${styles.viewSwitchButton} ${viewMode === 'edit' ? styles.viewSwitchButtonActive : ''}`}
                    onClick={() => setViewMode('edit')}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className={`${styles.viewSwitchButton} ${viewMode === 'preview' ? styles.viewSwitchButtonActive : ''}`}
                    onClick={() => setViewMode('preview')}
                  >
                    预览
                  </button>
                </div>
              </div>
              {documentLinkNotice && (
                <div className={styles.inlineNotice} role="status">
                  {documentLinkNotice}
                </div>
              )}
            </div>
          )}
          detailDocuments={displayDocuments}
          activeDetailDocumentPath={activeDocumentPath}
          detailSidebarCollapsed={detailSidebarCollapsed}
          onDetailSidebarCollapsedChange={setDetailSidebarCollapsed}
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
