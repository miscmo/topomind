import { useState, useCallback, useRef, useEffect } from 'react'
import { LocalDB } from '../../../core/localdb-backend'
import { useDraftStore } from './draftStore'
import { useCardContentStore } from './cardContentStore'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { joinRefs } from '../../../domain/graph/path-utils'
import { topoDocumentIdFromKey, topoDocumentKey } from '../../../features/documents/types/documentTypes'
import { useDetailPanelStore } from './detailPanelStore'
import type { TopoDocumentManifestItem, TopoDocumentType, TrashTopoDocumentItem } from '../../../core/storage'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { isTopoDocumentType } from '../../../core/topoDocumentTypes'
import type { LocalDocumentRecord } from '../../../types/local-sync'
import { useConfirmStore } from '../../../shared/ui/ConfirmModal/confirmStore'

function toUnixTime(value: string | null) {
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function mapLocalDocumentToManifestItem(document: LocalDocumentRecord): TopoDocumentManifestItem | null {
  if (!isTopoDocumentType(document.type)) {
    return null
  }

  return {
    id: document.id,
    type: document.type,
    title: document.title,
    fileName: document.fileName,
    parentId: document.parentDocumentId,
    sortOrder: document.sortOrder,
    createdAt: toUnixTime(document.createdAt),
    updatedAt: toUnixTime(document.updatedAt),
    version: document.version,
  }
}

function mapLocalDocumentToTrashItem(document: LocalDocumentRecord): TrashTopoDocumentItem | null {
  if (!isTopoDocumentType(document.type) || !document.deletedAt) {
    return null
  }

  const deletedAt = Date.parse(document.deletedAt)
  return {
    trashName: document.id,
    originalName: document.title,
    originalPath: document.fileName,
    deletedAt: Number.isFinite(deletedAt) ? deletedAt : Date.now(),
    size: 0,
    isDirectory: false,
    documentId: document.id,
    title: document.title,
    type: document.type,
  }
}

export function useDetailDocuments({
  selectedNodeId,
  cardRef,
  activeDocumentKey,
  setActiveDocumentKey,
  flushDocumentSave,
}: {
  selectedNodeId: string | null
  cardRef: string | null
  activeDocumentKey: string
  setActiveDocumentKey: (documentKey: string | ((prev: string) => string)) => void
  flushDocumentSave: () => Promise<void>
}) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const confirm = useConfirmStore((s) => s.open)
  const clearDocumentDraft = useDraftStore((s) => s.clearDocumentDraft)
  const clearDocumentContent = useCardContentStore((s) => s.clearDocumentContent)
  const setDocumentListForCardRef = useDetailPanelStore((s) => s.setDocumentListForCardRef)
  const setTrashDocumentListForCardRef = useDetailPanelStore((s) => s.setTrashDocumentListForCardRef)

  const [topoDocuments, setTopoDocuments] = useState<TopoDocumentManifestItem[]>(() => (
    cardRef ? (useDetailPanelStore.getState().documentListsByCardRef[cardRef] ?? []) : []
  ))
  const [trashTopoDocuments, setTrashTopoDocuments] = useState<TrashTopoDocumentItem[]>(() => (
    cardRef ? (useDetailPanelStore.getState().trashDocumentListsByCardRef[cardRef] ?? []) : []
  ))
  const [topoDocumentsCardRef, setTopoDocumentsCardRef] = useState(() => cardRef ?? '')
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')

  const documentListRequestSeqRef = useRef(0)

  useEffect(() => {
    if (!cardRef) {
      setTopoDocuments([])
      setTrashTopoDocuments([])
      setTopoDocumentsCardRef('')
      return
    }
    const state = useDetailPanelStore.getState()
    setTopoDocuments(state.documentListsByCardRef[cardRef] ?? [])
    setTrashTopoDocuments(state.trashDocumentListsByCardRef[cardRef] ?? [])
    setTopoDocumentsCardRef(cardRef)
  }, [cardRef])

  const loadDocuments = useCallback(async (cardRef: string, requestSeq?: number) => {
    if (!currentWorkspaceId || !selectedNodeId || !cardRef) {
      setTopoDocuments([])
      setTopoDocumentsCardRef(cardRef)
      setDocumentListForCardRef(cardRef, [])
      setActiveDocumentKey('')
      return [] as TopoDocumentManifestItem[]
    }

    const nextTopoDocuments = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
      .then((snapshot) =>
        snapshot.documents
          .filter((document) => !document.deletedAt && document.cardId === selectedNodeId)
          .map(mapLocalDocumentToManifestItem)
          .filter((item): item is TopoDocumentManifestItem => item !== null)
          .sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
            return a.title.localeCompare(b.title, 'zh-CN')
          }),
      )
      .catch((e) => {
        logger.catch('DetailPanel', `loadTopoDocuments: ${cardRef}`, e)
        return [] as TopoDocumentManifestItem[]
      })
    if (requestSeq !== undefined && documentListRequestSeqRef.current !== requestSeq) {
      return nextTopoDocuments
    }
    setTopoDocuments(nextTopoDocuments)
    setTopoDocumentsCardRef(cardRef)
    setDocumentListForCardRef(cardRef, nextTopoDocuments)
    
    // Default to the first available document if the active one doesn't exist anymore
    setActiveDocumentKey((currentDocumentKey) => {
      if (nextTopoDocuments.some((item) => topoDocumentKey(item.id) === currentDocumentKey)) {
        return currentDocumentKey
      }
      return nextTopoDocuments.length > 0 ? topoDocumentKey(nextTopoDocuments[0].id) : ''
    })
    return nextTopoDocuments
  }, [currentWorkspaceId, selectedNodeId, setDocumentListForCardRef, setActiveDocumentKey])

  const loadTrashDocuments = useCallback(async (cardRef: string) => {
    if (!currentWorkspaceId || !selectedNodeId || !cardRef) {
      setTrashTopoDocuments([])
      setTrashDocumentListForCardRef(cardRef, [])
      return [] as TrashTopoDocumentItem[]
    }

    const nextTrashDocuments = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
      .then((snapshot) =>
        snapshot.documents
          .filter((document) => Boolean(document.deletedAt) && document.cardId === selectedNodeId)
          .map(mapLocalDocumentToTrashItem)
          .filter((item): item is TrashTopoDocumentItem => item !== null)
          .sort((a, b) => b.deletedAt - a.deletedAt),
      )
      .catch((e) => {
        logger.catch('DetailPanel', `loadTrashDocuments: ${cardRef}`, e)
        return [] as TrashTopoDocumentItem[]
      })
    setTrashTopoDocuments(nextTrashDocuments)
    setTrashDocumentListForCardRef(cardRef, nextTrashDocuments)
    return nextTrashDocuments
  }, [currentWorkspaceId, selectedNodeId, setTrashDocumentListForCardRef])

  useEffect(() => {
    if (!documentLinkNotice) return
    const timeoutId = window.setTimeout(() => {
      setDocumentLinkNotice('')
    }, 2600)
    return () => window.clearTimeout(timeoutId)
  }, [documentLinkNotice])

  const handleSelectDocument = useCallback(async (documentKey: string) => {
    if (documentKey === activeDocumentKey) return
    try {
      await flushDocumentSave()
      setActiveDocumentKey(documentKey)
    } catch (e) {
      setDocumentLinkNotice('保存当前文档失败，已取消切换。')
      logger.catch('DetailPanel', 'handleSelectDocument', e)
    }
  }, [activeDocumentKey, flushDocumentSave, setActiveDocumentKey])

  const handleOpenDetailDocumentLink = useCallback(async (documentKey: string) => {
    if (!cardRef) return
    const nextDocuments = await loadDocuments(cardRef)
    if (!nextDocuments.some((item) => topoDocumentKey(item.id) === documentKey)) {
      setDocumentLinkNotice(`未找到文档：${documentKey}`)
      return
    }
    setDocumentLinkNotice('')
    await handleSelectDocument(documentKey)
  }, [cardRef, handleSelectDocument, loadDocuments])

  const createTopoDocumentByType = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    if (!currentWorkspaceId || !selectedNodeId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }

    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await LocalDB.createDocument({
        workspaceId: currentWorkspaceId,
        cardId: selectedNodeId,
        type,
        title: name,
        parentDocumentId: parentId ?? null,
      })
      await Promise.all([loadDocuments(cardRef), loadTrashDocuments(cardRef)])
      setActiveDocumentKey(topoDocumentKey(created.id))
      setDocumentLinkNotice('')
      logAction('多类型文档:创建', 'DetailPanel', {
        cardRef,
        cardId: selectedNodeId,
        documentId: created.id,
        type,
        title: name,
        parentDocumentId: parentId ?? null,
      })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '创建文档失败。')
      logger.catch('DetailPanel', 'createTopoDocumentByType', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [cardRef, currentWorkspaceId, flushDocumentSave, loadDocuments, loadTrashDocuments, selectedNodeId, setActiveDocumentKey])

  const handleCreateTopoDocument = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    await createTopoDocumentByType(type, name, parentId)
  }, [createTopoDocumentByType])

  const handleRenameDocument = useCallback(async (documentKey: string, name: string) => {
    if (!currentWorkspaceId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }

    const documentId = topoDocumentIdFromKey(documentKey)
    if (!documentId) {
      setDocumentLinkNotice(`未找到文档：${documentKey}`)
      return
    }

    setIsDocumentBusy(true)
    try {
      await LocalDB.updateDocument({
        documentId,
        title: name,
      })
      await Promise.all([loadDocuments(cardRef), loadTrashDocuments(cardRef)])
      setDocumentLinkNotice('')
      logAction('多类型文档:重命名', 'DetailPanel', { cardRef, documentId, title: name })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '重命名文档失败。')
      logger.catch('DetailPanel', 'handleRenameDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [cardRef, currentWorkspaceId, loadDocuments, loadTrashDocuments])

  const handleDeleteDocument = useCallback(async (documentKey: string = activeDocumentKey) => {
    if (!currentWorkspaceId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }

    const documentId = topoDocumentIdFromKey(documentKey)
    if (!documentId) {
      setDocumentLinkNotice(`未找到文档：${documentKey}`)
      return
    }

    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      await LocalDB.deleteDocument({ documentId })
      await Promise.all([loadDocuments(cardRef), loadTrashDocuments(cardRef)])
      setDocumentLinkNotice('')
      logAction('多类型文档:删除', 'DetailPanel', { cardRef, documentId })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '删除文档失败。')
      logger.catch('DetailPanel', 'handleDeleteDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentKey, cardRef, currentWorkspaceId, flushDocumentSave, loadDocuments, loadTrashDocuments])

  const handleRestoreDocument = useCallback(async (trashName: string) => {
    if (!currentWorkspaceId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }

    setIsDocumentBusy(true)
    try {
      const restored = await LocalDB.restoreDocument({ documentId: trashName })
      await Promise.all([loadDocuments(cardRef), loadTrashDocuments(cardRef)])
      setActiveDocumentKey(topoDocumentKey(restored.id))
      setDocumentLinkNotice('')
      logAction('多类型文档:恢复', 'DetailPanel', { cardRef, documentId: restored.id })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '恢复文档失败。')
      logger.catch('DetailPanel', 'handleRestoreDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [cardRef, currentWorkspaceId, loadDocuments, loadTrashDocuments, setActiveDocumentKey])

  const handleClearTrashDocuments = useCallback(async () => {
    if (!currentWorkspaceId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }
    if (trashTopoDocuments.length === 0) {
      setDocumentLinkNotice('文档回收站为空。')
      return
    }

    const confirmed = await confirm({
      title: '清空文档回收站',
      message: '确定要永久清空当前节点的文档回收站吗？该操作不可恢复。',
    })
    if (!confirmed) return

    setIsDocumentBusy(true)
    try {
      for (const item of trashTopoDocuments) {
        await LocalDB.purgeDocument({ documentId: item.documentId })
      }
      await Promise.all([loadDocuments(cardRef), loadTrashDocuments(cardRef)])
      setDocumentLinkNotice('')
      logAction('多类型文档:清空回收站', 'DetailPanel', {
        cardRef,
        count: trashTopoDocuments.length,
      })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '清空文档回收站失败。')
      logger.catch('DetailPanel', 'handleClearTrashDocuments', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [cardRef, confirm, currentWorkspaceId, loadDocuments, loadTrashDocuments, trashTopoDocuments])

  const handleMoveDocument = useCallback(async (documentId: string, newParentId: string | null, newSortOrder: number) => {
    if (!currentWorkspaceId || !cardRef) {
      setDocumentLinkNotice('当前工作区未接入云端文档写入。')
      return
    }

    setIsDocumentBusy(true)
    try {
      await LocalDB.updateDocument({
        documentId,
        parentDocumentId: newParentId,
        sortOrder: newSortOrder,
      })
      await loadDocuments(cardRef)
      setDocumentLinkNotice('')
      logAction('多类型文档:移动', 'DetailPanel', {
        cardRef,
        documentId,
        parentDocumentId: newParentId,
        sortOrder: newSortOrder,
      })
    } catch (e) {
      setDocumentLinkNotice(e instanceof Error ? e.message : '移动文档失败。')
      logger.catch('DetailPanel', 'handleMoveDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [cardRef, currentWorkspaceId, loadDocuments])

  const handleExportTopoDocument = useCallback(async (documentKey: string) => {
    const documentId = topoDocumentIdFromKey(documentKey)
    if (!documentId) return
    const localDocument = await LocalDB.getDocument(documentId).catch((error) => {
      logger.catch('DetailPanel', 'handleExportTopoDocument', error)
      return null
    })
    if (!localDocument) {
      setDocumentLinkNotice('导出失败：未找到对应文档。')
      return
    }

    const content = JSON.stringify(localDocument.contentJson ?? {}, null, 2)
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = localDocument.fileName
    try {
      document.body.appendChild(anchor)
      anchor.click()
    } finally {
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    logAction('多类型文档:导出', 'DetailPanel', { documentId, fileName: anchor.download, type: localDocument.type })
  }, [])

  const handleOpenCurrentDocumentFolder = useCallback(async (activeTopoDocumentId: string | null) => {
    void activeTopoDocumentId
    setDocumentLinkNotice('云端模式下暂不支持打开文档目录。')
  }, [])

  return {
    topoDocuments,
    trashTopoDocuments,
    setTopoDocuments,
    topoDocumentsCardRef,
    setTopoDocumentsCardRef,
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

