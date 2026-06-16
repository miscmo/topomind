import { useState, useCallback, useRef, useEffect } from 'react'
import { useStorage } from '../../../core/storage'
import { useConfirmStore } from '../../../shared/ui/ConfirmModal/confirmStore'
import { useDraftStore } from './draftStore'
import { useCardContentStore } from './cardContentStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { joinRefs } from '../../../domain/graph/path-utils'
import { topoDocumentIdFromPath, topoDocumentPath } from '../../../features/documents/types/documentTypes'
import { getTopoDocumentTypeDefinition } from '../../../features/documents/services/documentTypeRegistry'
import { useDetailPanelStore } from './detailPanelStore'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'

export function useDetailDocuments({
  selectedNodeId,
  nodePath,
  activeDocumentPath,
  setActiveDocumentPath,
  flushDocumentSave,
}: {
  selectedNodeId: string | null
  nodePath: string | null
  activeDocumentPath: string
  setActiveDocumentPath: (path: string | ((prev: string) => string)) => void
  flushDocumentSave: () => Promise<void>
}) {
  const storage = useStorage()
  const confirm = useConfirmStore((s) => s.open)
  const storeApi = useGraphStoreApi()
  const clearDetailDraft = useDraftStore((s) => s.clearDetailDraft)
  const clearDetailContent = useCardContentStore((s) => s.clearDetailContent)
  const setDocumentListForNodePath = useDetailPanelStore((s) => s.setDocumentListForNodePath)

  const [topoDocuments, setTopoDocuments] = useState<TopoDocumentManifestItem[]>(() => (
    nodePath ? (useDetailPanelStore.getState().documentListsByNodePath[nodePath] ?? []) : []
  ))
  const [topoDocumentsCardPath, setTopoDocumentsCardPath] = useState(() => nodePath ?? '')
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')

  const documentListRequestSeqRef = useRef(0)

  useEffect(() => {
    if (!nodePath) {
      setTopoDocuments([])
      setTopoDocumentsCardPath('')
      return
    }
    const state = useDetailPanelStore.getState()
    setTopoDocuments(state.documentListsByNodePath[nodePath] ?? [])
    setTopoDocumentsCardPath(nodePath)
  }, [nodePath])

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
    setDocumentListForNodePath(cardPath, nextTopoDocuments)
    
    // Default to the first available document if the active one doesn't exist anymore
    setActiveDocumentPath((currentPath) => {
      if (nextTopoDocuments.some((item) => topoDocumentPath(item.id) === currentPath)) {
        return currentPath
      }
      return nextTopoDocuments.length > 0 ? topoDocumentPath(nextTopoDocuments[0].id) : ''
    })
    return nextTopoDocuments
  }, [setDocumentListForNodePath, storage, setActiveDocumentPath])

  useEffect(() => {
    if (!documentLinkNotice) return
    const timeoutId = window.setTimeout(() => {
      setDocumentLinkNotice('')
    }, 2600)
    return () => window.clearTimeout(timeoutId)
  }, [documentLinkNotice])

  const handleSelectDocument = useCallback(async (documentPath: string) => {
    if (documentPath === activeDocumentPath) return
    try {
      await flushDocumentSave()
      setActiveDocumentPath(documentPath)
    } catch (e) {
      setDocumentLinkNotice('保存当前文档失败，已取消切换。')
      logger.catch('DetailPanel', 'handleSelectDocument', e)
    }
  }, [activeDocumentPath, flushDocumentSave, setActiveDocumentPath])

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

  const createTopoDocumentByType = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    const definition = getTopoDocumentTypeDefinition(type)
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await storage.createTopoDocument(nodePath, { type, title: nextName, parentId: parentId || null })
      const createdDocumentPath = topoDocumentPath(created.id)
      const createdDocumentKey = joinRefs(nodePath, createdDocumentPath)
      clearDetailDraft(createdDocumentKey)
      clearDetailContent(createdDocumentKey)
      const nextDocs = await loadDocuments(nodePath)
      
      // Make sure the document we just created is actually loaded in the tree
      if (nextDocs.some(d => d.id === created.id)) {
        setActiveDocumentPath(createdDocumentPath)
      } else {
        // Fallback to reload again or log warning if it failed to appear
        logger.warn('DetailPanel', `Created document ${created.id} not found in the reloaded list.`)
      }
      logAction(definition.createLogName, 'DetailPanel', { nodePath, documentId: created.id, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', `createTopoDocumentByType:${type}`, e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments, setActiveDocumentPath])

  const handleCreateTopoDocument = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    await createTopoDocumentByType(type, name, parentId)
  }, [createTopoDocumentByType])

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
      message: `将删除节点「${label}」的文档「${documentName}」。文档会移入全局回收站。`
    })
    if (!confirmed) return
    setIsDocumentBusy(true)
    try {
      const documentKey = joinRefs(nodePath, documentPath)
      if (documentPath === activeDocumentPath) {
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
  }, [activeDocumentPath, clearDetailDraft, clearDetailContent, confirm, topoDocuments, loadDocuments, nodePath, selectedNodeId, storeApi, storage, setActiveDocumentPath])

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

  const handleOpenCurrentDocumentFolder = useCallback(async (activeTopoDocumentId: string | null) => {
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
  }, [flushDocumentSave, nodePath, storage])

  return {
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
  }
}
