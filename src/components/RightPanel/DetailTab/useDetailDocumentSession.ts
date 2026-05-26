import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { registerTabSaver } from '../../../core/close-guard'
import { logger } from '../../../core/logger'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { areDocumentContentsEqual, getDocumentContentLength, prepareStructuredDocumentContentForSave } from '../../DocumentWorkspace/documentContentSession'

interface UseDetailDocumentSessionParams {
  tabId: string
  selectedNodeId: string | null
  nodePath: string | null
  currentDocumentKey: string
  activeDocumentPath: string
  activeTopoDocumentId: string | null
}

export function useDetailDocumentSession({
  tabId,
  selectedNodeId,
  nodePath,
  currentDocumentKey,
  activeDocumentPath,
  activeTopoDocumentId,
}: UseDetailDocumentSessionParams) {
  const storage = useStorage()
  const storeApi = useGraphStoreApi()
  const draftContent = useDraftStore((s) => currentDocumentKey ? (s.detailDrafts[currentDocumentKey] ?? '') : '')
  const setDraftContent = useDraftStore((s) => s.setDetailDraft)
  const detailEntry = useCardContentStore((s) => currentDocumentKey ? s.detailEntries[currentDocumentKey] : undefined)
  const setDetailContent = useCardContentStore((s) => s.setDetailContent)
  const [savedContent, setSavedContent] = useState<unknown>('')
  const [loadedDocumentKey, setLoadedDocumentKey] = useState('')
  const contentRequestSeqRef = useRef(0)
  const selectionPerfRef = useRef<{ nodeId: string; startedAt: number; logged: boolean } | null>(null)

  const handleSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    const saveStartedAt = performance.now()
    let savedContentLength = getDocumentContentLength(draftContent)

    try {
      if (activeTopoDocumentId) {
        let contentToWrite: unknown
        try {
          contentToWrite = prepareStructuredDocumentContentForSave(draftContent)
        } catch (parseError) {
          throw new Error(`文档内容解析失败，为防止覆盖，已终止保存: ${(parseError as Error).message}`)
        }

        await storage.writeTopoDocument(nodePath, activeTopoDocumentId, contentToWrite)
        setDetailContent(currentDocumentKey, contentToWrite)
        setDraftContent(currentDocumentKey, contentToWrite)
        setSavedContent(contentToWrite)
        savedContentLength = getDocumentContentLength(contentToWrite)
      } else {
        setDetailContent(currentDocumentKey, draftContent)
        setSavedContent(draftContent)
        savedContentLength = getDocumentContentLength(draftContent)
      }

      logAction('内容:保存', 'DetailPanel', { nodePath, documentPath: activeDocumentPath, label })
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: savedContentLength,
      }, 'DetailPanel')
    } catch (e) {
      void logPerformanceMetric(PERFORMANCE_METRICS.detailSave, performance.now() - saveStartedAt, {
        success: false,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength: getDocumentContentLength(draftContent),
        error: e instanceof Error ? e.message : String(e),
      }, 'DetailPanel')
      logger.catch('DetailPanel', 'handleSave', e)
      throw e
    }
  }, [activeDocumentPath, activeTopoDocumentId, selectedNodeId, nodePath, currentDocumentKey, storeApi, storage, draftContent, setDetailContent, setDraftContent])

  const flushDocumentSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    if (areDocumentContentsEqual(draftContent, savedContent)) return
    await handleSave()
  }, [selectedNodeId, nodePath, currentDocumentKey, draftContent, savedContent, handleSave])

  const isDocumentDirty = useMemo(() => areDocumentContentsEqual(draftContent, savedContent) === false, [draftContent, savedContent])

  useEffect(() => {
    setSavedContent('')
  }, [selectedNodeId, nodePath])

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

    const readPromise = activeTopoDocumentId
      ? storage.readTopoDocument(nodePath, activeTopoDocumentId)
      : Promise.resolve('')

    readPromise.then((content: unknown) => {
      if (contentRequestSeqRef.current !== requestSeq) return
      const contentLength = getDocumentContentLength(content)
      void logPerformanceMetric(PERFORMANCE_METRICS.detailRead, performance.now() - readStartedAt, {
        success: true,
        nodeId: selectedNodeId,
        nodePath,
        documentPath: activeDocumentPath,
        contentLength,
      }, 'DetailPanel')
      setDetailContent(currentDocumentKey, content)
      setSavedContent(content)
      setLoadedDocumentKey(currentDocumentKey)

      const currentDraft = useDraftStore.getState().detailDrafts[currentDocumentKey]
      if (currentDraft === undefined || currentDraft === cachedContent) {
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
          contentLength,
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
  }, [selectedNodeId, nodePath, activeDocumentPath, currentDocumentKey, activeTopoDocumentId, storage, setDraftContent, setDetailContent])

  useEffect(() => {
    if (activeDocumentPath !== '' && detailEntry) {
      setSavedContent(detailEntry.content)
    }
  }, [detailEntry, activeDocumentPath])

  useEffect(() => {
    return registerTabSaver(tabId, flushDocumentSave, () => areDocumentContentsEqual(draftContent, savedContent) === false)
  }, [tabId, flushDocumentSave, draftContent, savedContent])

  const handleDraftChange = useCallback((value: unknown) => {
    if (currentDocumentKey) setDraftContent(currentDocumentKey, value)
  }, [currentDocumentKey, setDraftContent])

  return {
    draftContent,
    isDocumentDirty,
    loadedDocumentKey,
    handleDraftChange,
    handleSave,
    flushDocumentSave,
  }
}
