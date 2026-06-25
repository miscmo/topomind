import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { registerTabSaver } from '../../../core/close-guard'
import { logger } from '../../../core/logger'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { useCardContentStore } from './cardContentStore'
import { useDraftStore } from './draftStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { areDocumentContentsEqual, getDocumentContentLength, prepareStructuredDocumentContentForSave } from '../../../features/documents/model/documentContentSession'

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
  const [savedContentState, setSavedContentState] = useState<{ key: string; content: unknown }>(() => ({
    key: currentDocumentKey,
    content: detailEntry?.content ?? ''
  }))
  const savedContent = savedContentState.key === currentDocumentKey ? savedContentState.content : ''
  const [loadedDocumentKey, setLoadedDocumentKey] = useState(() => (detailEntry ? currentDocumentKey : ''))
  const [isDocumentDirty, setIsDocumentDirty] = useState(false)
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
        
        if (contentToWrite === null) {
          // Empty content, no need to save for topo document, just return early or proceed to update draft state
          contentToWrite = {}
        }

        await storage.writeTopoDocument(nodePath, activeTopoDocumentId, contentToWrite)
        setDetailContent(currentDocumentKey, contentToWrite)
        setDraftContent(currentDocumentKey, contentToWrite)
        setSavedContentState({ key: currentDocumentKey, content: contentToWrite })
        setIsDocumentDirty(false)
        savedContentLength = getDocumentContentLength(contentToWrite)
      } else {
        setDetailContent(currentDocumentKey, draftContent)
        setSavedContentState({ key: currentDocumentKey, content: draftContent })
        setIsDocumentDirty(false)
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
    if (!isDocumentDirty) return
    if (areDocumentContentsEqual(draftContent, savedContent)) {
      setIsDocumentDirty(false)
      return
    }
    await handleSave()
  }, [selectedNodeId, nodePath, currentDocumentKey, isDocumentDirty, draftContent, savedContent, handleSave])

  const isContentLoaded = useMemo(() => {
    if (!currentDocumentKey) return false
    return loadedDocumentKey === currentDocumentKey || detailEntry !== undefined
  }, [currentDocumentKey, detailEntry, loadedDocumentKey])

  useEffect(() => {
    setSavedContentState({ key: currentDocumentKey, content: '' })
    setIsDocumentDirty(false)
  }, [selectedNodeId, nodePath, currentDocumentKey])

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
      setSavedContentState({ key: currentDocumentKey, content: cachedContent })
      setLoadedDocumentKey(currentDocumentKey)
      setIsDocumentDirty(false)
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
      setSavedContentState({ key: currentDocumentKey, content })
      setLoadedDocumentKey(currentDocumentKey)
      setIsDocumentDirty(false)

      const currentDraft = useDraftStore.getState().detailDrafts[currentDocumentKey]
      if (currentDraft === undefined || currentDraft === cachedContent || currentDraft === '') {
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
      setSavedContentState({ key: currentDocumentKey, content: '' })
      setLoadedDocumentKey(currentDocumentKey)
      setIsDocumentDirty(false)

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
    if (currentDocumentKey && detailEntry) {
      setSavedContentState({ key: currentDocumentKey, content: detailEntry.content })
    }
  }, [detailEntry, currentDocumentKey])

  useEffect(() => {
    return registerTabSaver(tabId, flushDocumentSave, () => isDocumentDirty)
  }, [tabId, flushDocumentSave, isDocumentDirty])

  const handleDraftChange = useCallback((value: unknown) => {
    if (!currentDocumentKey) return
    setDraftContent(currentDocumentKey, value)
    setIsDocumentDirty((current) => current || !areDocumentContentsEqual(value, savedContent))
  }, [currentDocumentKey, savedContent, setDraftContent])

  return {
    draftContent,
    isDocumentDirty,
    isContentLoaded,
    loadedDocumentKey,
    handleDraftChange,
    handleSave,
    flushDocumentSave,
  }
}
