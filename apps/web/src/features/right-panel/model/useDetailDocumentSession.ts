import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LocalDB } from '../../../core/localdb-backend'
import { CLOUD_LOCALDB_UPDATED_EVENT, requestCloudSyncWake } from '../../../application/cloud/events'
import { registerTabSaver } from '../../../core/close-guard'
import { logger } from '../../../core/logger'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { useCardContentStore } from './cardContentStore'
import { useDraftStore } from './draftStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import type { DocumentSyncStatus } from '../../../features/documents/types/workspaceTypes'
import { areDocumentContentsEqual, getDocumentContentLength, prepareStructuredDocumentContentForSave } from '../../../features/documents/model/documentContentSession'

interface UseDetailDocumentSessionParams {
  tabId: string
  currentWorkspaceId: string | null
  selectedNodeId: string | null
  currentKbId: string | null
  currentRoomId: string | null
  currentRoomRef: string
  cardRef: string | null
  currentDocumentKey: string
  activeDocumentKey: string
  activeTopoDocumentId: string | null
}

function sortByUpdatedAtDesc<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

async function readDocumentSyncStatus(
  workspaceId: string,
  documentId: string,
  hasUnsavedDraft: boolean,
): Promise<DocumentSyncStatus | null> {
  const [document, pendingOutboxItems, conflicts] = await Promise.all([
    LocalDB.getDocument(documentId),
    LocalDB.listPendingOutbox(workspaceId, 200),
    LocalDB.listSyncConflicts(workspaceId, 200),
  ])

  if (!document) {
    return null
  }

  const openConflict = sortByUpdatedAtDesc(
    conflicts.filter(
      (item) =>
        item.entityType === 'document'
        && item.entityId === documentId
        && item.status === 'open',
    ),
  )[0]
  if (openConflict) {
    return {
      tone: 'warning',
      text: `同步冲突：${openConflict.errorMessage || '请前往监控页处理'}`,
    }
  }

  const documentOutboxItems = sortByUpdatedAtDesc(
    pendingOutboxItems.filter(
      (item) => item.entityType === 'document' && item.entityId === documentId,
    ),
  )
  const failedItem = documentOutboxItems.find(
    (item) => item.status === 'failed' || item.status === 'conflicted',
  )
  if (failedItem) {
    return {
      tone: 'error',
      text: `同步失败：${failedItem.lastErrorMessage || '等待重试'}`,
    }
  }

  if (documentOutboxItems.some((item) => item.status === 'sending')) {
    return {
      tone: 'info',
      text: `云端同步中，版本 v${document.version}`,
    }
  }

  if (documentOutboxItems.some((item) => item.status === 'pending')) {
    return {
      tone: 'info',
      text: `等待云端同步，版本 v${document.version}`,
    }
  }

  if (hasUnsavedDraft) {
    return {
      tone: 'info',
      text: `本地草稿待保存，当前版本 v${document.version}`,
    }
  }

  return {
    tone: 'success',
    text: `云端已同步，版本 v${document.version}`,
  }
}

export function useDetailDocumentSession({
  tabId,
  currentWorkspaceId,
  selectedNodeId,
  currentKbId,
  currentRoomId,
  currentRoomRef,
  cardRef,
  currentDocumentKey,
  activeDocumentKey,
  activeTopoDocumentId,
}: UseDetailDocumentSessionParams) {
  const editorReadOnly = false
  const storeApi = useGraphStoreApi()
  const draftContent = useDraftStore((s) => currentDocumentKey ? (s.documentDrafts[currentDocumentKey] ?? '') : '')
  const setDraftContent = useDraftStore((s) => s.setDocumentDraft)
  const detailEntry = useCardContentStore((s) => currentDocumentKey ? s.documentContentEntries[currentDocumentKey] : undefined)
  const setDocumentContent = useCardContentStore((s) => s.setDocumentContent)
  const [savedContentState, setSavedContentState] = useState<{ key: string; content: unknown }>(() => ({
    key: currentDocumentKey,
    content: detailEntry?.content ?? ''
  }))
  const savedContent = savedContentState.key === currentDocumentKey ? savedContentState.content : ''
  const [loadedDocumentKey, setLoadedDocumentKey] = useState(() => (detailEntry ? currentDocumentKey : ''))
  const [documentSyncStatus, setDocumentSyncStatus] = useState<DocumentSyncStatus | null>(null)
  const contentRequestSeqRef = useRef(0)
  const syncStatusRequestSeqRef = useRef(0)
  const selectionPerfRef = useRef<{ nodeId: string; startedAt: number; logged: boolean } | null>(null)

  const isDocumentDirty = useMemo(
    () => (!editorReadOnly && areDocumentContentsEqual(draftContent, savedContent) === false),
    [draftContent, editorReadOnly, savedContent],
  )

  const handleSave = useCallback(async () => {
    if (editorReadOnly) return
    if (!selectedNodeId || !cardRef || !currentDocumentKey) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    const saveStartedAt = performance.now()
    let savedContentLength = getDocumentContentLength(draftContent)

    try {
      if (activeTopoDocumentId) {
        const nextContentJson = prepareStructuredDocumentContentForSave(draftContent)
        const savedDocument = await LocalDB.updateDocumentContent({
          documentId: activeTopoDocumentId,
          contentJson: nextContentJson,
        })
        const nextSavedContent = savedDocument.contentJson ?? {}
        setDocumentContent(currentDocumentKey, nextSavedContent)
        setSavedContentState({ key: currentDocumentKey, content: nextSavedContent })
        savedContentLength = getDocumentContentLength(nextSavedContent)
        setDocumentSyncStatus({
          tone: 'info',
          text: `等待云端同步，版本 v${savedDocument.version}`,
        })
        requestCloudSyncWake('detail-document-autosave')
      } else {
        setDocumentContent(currentDocumentKey, draftContent)
        setSavedContentState({ key: currentDocumentKey, content: draftContent })
        savedContentLength = getDocumentContentLength(draftContent)
      }

      logAction('内容:保存', 'DetailPanel', {
        kbId: currentKbId,
        roomId: currentRoomId,
        roomRef: currentRoomRef,
        nodeId: selectedNodeId,
        cardRef,
        documentKey: activeDocumentKey,
        label,
      })
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: true,
        kbId: currentKbId,
        roomId: currentRoomId,
        roomRef: currentRoomRef,
        nodeId: selectedNodeId,
        cardRef,
        documentKey: activeDocumentKey,
        contentLength: savedContentLength,
      }, 'DetailPanel')
    } catch (e) {
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: false,
        kbId: currentKbId,
        roomId: currentRoomId,
        roomRef: currentRoomRef,
        nodeId: selectedNodeId,
        cardRef,
        documentKey: activeDocumentKey,
        contentLength: getDocumentContentLength(draftContent),
        error: e instanceof Error ? e.message : String(e),
      }, 'DetailPanel')
      logger.catch('DetailPanel', 'handleSave', e)
      throw e
    }
  }, [activeDocumentKey, activeTopoDocumentId, currentKbId, currentRoomId, currentRoomRef, selectedNodeId, cardRef, currentDocumentKey, storeApi, editorReadOnly, draftContent, setDocumentContent])

  const flushDocumentSave = useCallback(async () => {
    if (!selectedNodeId || !cardRef || !currentDocumentKey) return
    const isEqual = areDocumentContentsEqual(draftContent, savedContent)
    if (isEqual) return
    await handleSave()
  }, [selectedNodeId, cardRef, currentDocumentKey, draftContent, savedContent, handleSave])
  const isContentLoaded = useMemo(() => {
    if (!currentDocumentKey) return false
    return loadedDocumentKey === currentDocumentKey || detailEntry !== undefined
  }, [currentDocumentKey, detailEntry, loadedDocumentKey])

  useEffect(() => {
    setSavedContentState({ key: currentDocumentKey, content: '' })
    setDocumentSyncStatus(null)
  }, [selectedNodeId, cardRef, currentDocumentKey])

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
    if (!selectedNodeId || !cardRef || !currentDocumentKey) return
    const readStartedAt = performance.now()

    const cachedContent = useCardContentStore.getState().documentContentEntries[currentDocumentKey]?.content
    if (cachedContent !== undefined) {
      setSavedContentState({ key: currentDocumentKey, content: cachedContent })
      setLoadedDocumentKey(currentDocumentKey)
      if (useDraftStore.getState().documentDrafts[currentDocumentKey] === undefined) {
        setDraftContent(currentDocumentKey, cachedContent)
      }
      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: true,
          kbId: currentKbId,
          roomId: currentRoomId,
          roomRef: currentRoomRef,
          nodeId: selectedNodeId,
          cardRef,
          documentKey: activeDocumentKey,
          cacheHit: true,
        }, 'DetailPanel')
      }
    }

    const readPromise = activeTopoDocumentId
      ? LocalDB.getDocument(activeTopoDocumentId).then((document) => document?.contentJson ?? '')
      : Promise.resolve('')

    readPromise.then((content: unknown) => {
      if (contentRequestSeqRef.current !== requestSeq) return
      const contentLength = getDocumentContentLength(content)
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: true,
        kbId: currentKbId,
        roomId: currentRoomId,
        roomRef: currentRoomRef,
        nodeId: selectedNodeId,
        cardRef,
        documentKey: activeDocumentKey,
        contentLength,
      }, 'DetailPanel')
      setDocumentContent(currentDocumentKey, content)
      setSavedContentState({ key: currentDocumentKey, content })
      setLoadedDocumentKey(currentDocumentKey)

      const currentDraft = useDraftStore.getState().documentDrafts[currentDocumentKey]
      if (currentDraft === undefined || currentDraft === cachedContent || currentDraft === '') {
        setDraftContent(currentDocumentKey, content)
      }
      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: true,
          kbId: currentKbId,
          roomId: currentRoomId,
          roomRef: currentRoomRef,
          nodeId: selectedNodeId,
          cardRef,
          documentKey: activeDocumentKey,
          cacheHit: false,
          contentLength,
        }, 'DetailPanel')
      }
    }).catch(() => {
      if (contentRequestSeqRef.current !== requestSeq) return
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: false,
        kbId: currentKbId,
        roomId: currentRoomId,
        roomRef: currentRoomRef,
        nodeId: selectedNodeId,
        cardRef,
        documentKey: activeDocumentKey,
      }, 'DetailPanel')
      setDocumentContent(currentDocumentKey, '')
      setSavedContentState({ key: currentDocumentKey, content: '' })
      setLoadedDocumentKey(currentDocumentKey)

      const selectionPerf = selectionPerfRef.current
      if (selectionPerf && selectionPerf.nodeId === selectedNodeId && !selectionPerf.logged) {
        selectionPerf.logged = true
        void logPerformanceMetric(PERFORMANCE_METRICS.nodeSelect, performance.now() - selectionPerf.startedAt, {
          success: false,
          kbId: currentKbId,
          roomId: currentRoomId,
          roomRef: currentRoomRef,
          nodeId: selectedNodeId,
          cardRef,
          documentKey: activeDocumentKey,
        }, 'DetailPanel')
      }
    })
  }, [selectedNodeId, currentKbId, currentRoomId, currentRoomRef, cardRef, activeDocumentKey, currentDocumentKey, activeTopoDocumentId, setDraftContent, setDocumentContent])

  useEffect(() => {
    if (currentDocumentKey && detailEntry) {
      setSavedContentState({ key: currentDocumentKey, content: detailEntry.content })
    }
  }, [detailEntry, currentDocumentKey])

  useEffect(() => {
    const requestSeq = ++syncStatusRequestSeqRef.current
    if (!currentWorkspaceId || !activeTopoDocumentId) {
      setDocumentSyncStatus(null)
      return
    }

    const refreshSyncStatus = () => {
      void readDocumentSyncStatus(currentWorkspaceId, activeTopoDocumentId, isDocumentDirty)
        .then((nextStatus) => {
          if (syncStatusRequestSeqRef.current !== requestSeq) {
            return
          }
          setDocumentSyncStatus(nextStatus)
        })
        .catch((error) => {
          if (syncStatusRequestSeqRef.current !== requestSeq) {
            return
          }
          logger.catch('DetailPanel', 'refreshDocumentSyncStatus', error)
        })
    }

    refreshSyncStatus()

    const intervalId = window.setInterval(refreshSyncStatus, 3000)
    const handleLocalDbUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (detail?.workspaceId && detail.workspaceId !== currentWorkspaceId) {
        return
      }
      refreshSyncStatus()
    }
    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated)
      if (syncStatusRequestSeqRef.current === requestSeq) {
        syncStatusRequestSeqRef.current += 1
      }
    }
  }, [activeTopoDocumentId, currentWorkspaceId, isDocumentDirty])

  useEffect(() => {
    if (editorReadOnly) {
      return () => {}
    }
    return registerTabSaver(tabId, flushDocumentSave, () => areDocumentContentsEqual(draftContent, savedContent) === false)
  }, [tabId, flushDocumentSave, editorReadOnly, draftContent, savedContent])

  const handleDraftChange = useCallback((value: unknown) => {
    if (currentDocumentKey) {
      setDraftContent(currentDocumentKey, value)
    }
  }, [currentDocumentKey, setDraftContent])

  return {
    draftContent,
    isDocumentDirty,
    documentSyncStatus,
    editorReadOnly,
    isContentLoaded,
    loadedDocumentKey,
    handleDraftChange,
    handleSave,
    flushDocumentSave,
  }
}
