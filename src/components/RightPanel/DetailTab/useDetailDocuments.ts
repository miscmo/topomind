import { useState, useCallback, useRef, useEffect } from 'react'
import { useStorage } from '../../../core/storage'
import { useConfirmStore } from '../../../stores/confirmStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { joinRefs } from '../../../domain/graph/path-utils'
import { topoDocumentIdFromPath, topoDocumentPath } from '../../DocumentWorkspace/documentTypes'
import { getTopoDocumentTypeDefinition } from '../../DocumentWorkspace/documentTypeRegistry'
import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'
import type { FSBTrashTopoDocumentItem } from '../../../core/fs-backend'

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

  const [topoDocuments, setTopoDocuments] = useState<TopoDocumentManifestItem[]>([])
  const [trashTopoDocuments, setTrashTopoDocuments] = useState<FSBTrashTopoDocumentItem[]>([])
  const [topoDocumentsCardPath, setTopoDocumentsCardPath] = useState('')
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')

  const documentListRequestSeqRef = useRef(0)

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
      if (nextTopoDocuments.some((item) => topoDocumentPath(item.id) === currentPath)) {
        return currentPath
      }
      return nextTopoDocuments.length > 0 ? topoDocumentPath(nextTopoDocuments[0].id) : ''
    })
    return nextTopoDocuments
  }, [storage, setActiveDocumentPath])

  const loadTrashDocuments = useCallback(async (cardPath: string) => {
    if (!cardPath) {
      setTrashTopoDocuments([])
      return [] as FSBTrashTopoDocumentItem[]
    }
    const nextTrashDocuments = await storage.listTrashTopoDocuments(cardPath).catch((e) => {
      logger.catch('DetailPanel', `loadTrashTopoDocuments: ${cardPath}`, e)
      return [] as FSBTrashTopoDocumentItem[]
    })
    setTrashTopoDocuments(nextTrashDocuments)
    return nextTrashDocuments
  }, [storage])

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
      await loadDocuments(nodePath)
      setActiveDocumentPath(createdDocumentPath)
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
      message: `将删除节点「${label}」的文档「${documentName}」。文档会移入回收站，可从文档侧栏恢复。`
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
      await loadTrashDocuments(nodePath)
      if (documentPath === activeDocumentPath || activeDocumentPath === '') {
        setActiveDocumentPath(nextDocs.length > 0 ? topoDocumentPath(nextDocs[0].id) : '')
      }
      
      logAction('文档:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path: nodePath, documentPath })
    } catch (e) {
      logger.catch('DetailPanel', 'handleDeleteDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, clearDetailDraft, clearDetailContent, confirm, topoDocuments, loadDocuments, loadTrashDocuments, nodePath, selectedNodeId, storeApi, storage, setActiveDocumentPath])

  const handleRestoreDocument = useCallback(async (trashName: string) => {
    if (!nodePath || !trashName) return
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const restored = await storage.restoreTrashTopoDocument(nodePath, trashName)
      await loadDocuments(nodePath)
      await loadTrashDocuments(nodePath)
      setActiveDocumentPath(topoDocumentPath(restored.id))
      logAction('文档:恢复', 'DetailPanel', { nodePath, trashName, documentId: restored.id })
    } catch (e) {
      setDocumentLinkNotice(`恢复文档失败：${e instanceof Error ? e.message : String(e)}`)
      logger.catch('DetailPanel', 'handleRestoreDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [flushDocumentSave, loadDocuments, loadTrashDocuments, nodePath, setActiveDocumentPath, storage])

  const handleClearTrashDocuments = useCallback(async () => {
    if (!nodePath || trashTopoDocuments.length === 0) return
    const confirmed = await confirm({
      title: '清空文档回收站',
      message: '确定要永久清空当前节点的文档回收站吗？该操作不可恢复。'
    })
    if (!confirmed) return
    setIsDocumentBusy(true)
    try {
      await storage.clearTrashTopoDocuments(nodePath)
      await loadTrashDocuments(nodePath)
      logAction('文档:清空回收站', 'DetailPanel', { nodePath, count: trashTopoDocuments.length })
    } catch (e) {
      setDocumentLinkNotice(`清空文档回收站失败：${e instanceof Error ? e.message : String(e)}`)
      logger.catch('DetailPanel', 'handleClearTrashDocuments', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [confirm, loadTrashDocuments, nodePath, storage, trashTopoDocuments.length])

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
  }
}
