import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import {
  getDocumentExternalRevision,
  getDocumentExternalWrite,
  markDocumentDirty,
  useDocumentExternalRevision,
} from '../../../features/documents/services/documentExternalWriteBus'
import { registerTabSaver } from '../../../core/close-guard'
import { logger } from '../../../core/logger'
import { logAction } from '../../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS, takePerformanceMetricStart } from '../../../core/performance-log'
import { useCardContentStore } from './cardContentStore'
import { useDraftStore } from './draftStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { toast } from '../../../shared/ui/Toaster/toastStore'
import { areDocumentContentsEqual, getDocumentContentLength, prepareStructuredDocumentContentForSave } from '../../../features/documents/model/documentContentSession'

interface UseDetailDocumentSessionParams {
  tabId: string
  selectedNodeId: string | null
  nodePath: string | null
  currentDocumentKey: string
  activeDocumentPath: string
  activeTopoDocumentId: string | null
  isActive?: boolean
}

export function useDetailDocumentSession({
  tabId,
  selectedNodeId,
  nodePath,
  currentDocumentKey,
  activeDocumentPath,
  activeTopoDocumentId,
  isActive = true,
}: UseDetailDocumentSessionParams) {
  const storage = useStorage()
  const storeApi = useGraphStoreApi()
  const hasDraft = useDraftStore((s) => Boolean(
    currentDocumentKey && Object.prototype.hasOwnProperty.call(s.detailDrafts, currentDocumentKey)
  ))
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
  const saveRequestSeqRef = useRef(0)
  const draftVersionRef = useRef(0)
  const savedDraftVersionRef = useRef(0)
  const selectionPerfRef = useRef<{ nodeId: string; startedAt: number; logged: boolean } | null>(null)
  const externalRevision = useDocumentExternalRevision(activeTopoDocumentId)
  const adoptedExternalRevisionRef = useRef<{ docId: string | null; revision: number }>({
    docId: null, revision: -1,
  })

  const handleSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath || !currentDocumentKey) return
    const saveKey = currentDocumentKey
    const saveSeq = ++saveRequestSeqRef.current
    const saveVersion = draftVersionRef.current
    const contentSnapshot = draftContent
    // AI 外部写入：本次保存启动时记下 revision，写盘前再比一次。若期间 AI 已写盘，
    // 这份 draft 就是陈旧的整篇内容，绝对不能覆盖回去（1500ms autosave 的最大风险）。
    const externalRevisionAtStart = activeTopoDocumentId
      ? getDocumentExternalRevision(activeTopoDocumentId)
      : 0
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    const saveStartedAt = performance.now()
    let savedContentLength: number

    try {
      if (activeTopoDocumentId) {
        let contentToWrite: unknown
        try {
          contentToWrite = prepareStructuredDocumentContentForSave(contentSnapshot)
        } catch (parseError) {
          throw new Error(`文档内容解析失败，为防止覆盖，已终止保存: ${(parseError as Error).message}`, { cause: parseError })
        }

        if (contentToWrite === null) contentToWrite = {}
        if (activeTopoDocumentId
          && getDocumentExternalRevision(activeTopoDocumentId) !== externalRevisionAtStart) {
          // 放弃这次陈旧保存即可：外部写入的认领 effect 已把新内容设为干净基线。
          return
        }
        await storage.writeTopoDocument(nodePath, activeTopoDocumentId, contentToWrite)

        if (saveRequestSeqRef.current !== saveSeq || draftVersionRef.current !== saveVersion || currentDocumentKey !== saveKey) {
          return
        }
        setDetailContent(saveKey, contentToWrite)
        setDraftContent(saveKey, contentToWrite)
        setSavedContentState({ key: saveKey, content: contentToWrite })
        savedDraftVersionRef.current = draftVersionRef.current
        setIsDocumentDirty(false)
        savedContentLength = getDocumentContentLength(contentToWrite)
      } else {
        if (saveRequestSeqRef.current !== saveSeq || draftVersionRef.current !== saveVersion || currentDocumentKey !== saveKey) {
          return
        }
        setDetailContent(saveKey, contentSnapshot)
        setSavedContentState({ key: saveKey, content: contentSnapshot })
        savedDraftVersionRef.current = draftVersionRef.current
        setIsDocumentDirty(false)
        savedContentLength = getDocumentContentLength(contentSnapshot)
      }

      logAction('document.save', 'DetailPanel', { nodePath, documentPath: activeDocumentPath, label })
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
    if (draftVersionRef.current === savedDraftVersionRef.current) {
      setIsDocumentDirty(false)
      return
    }
    if (areDocumentContentsEqual(draftContent, savedContent)) {
      setIsDocumentDirty(false)
      savedDraftVersionRef.current = draftVersionRef.current
      return
    }
    try {
      await handleSave()
    } catch (e) {
      // 切换文档 / 关闭标签时 flush 是 fire-and-forget，失败若继续上抛会变成
      // unhandled rejection，用户完全无感知。这里吞掉并显式告警。
      // 保留 isDocumentDirty=true，使数据不会在不知情下丢失，下次 flush/关闭时仍会重试。
      const message = e instanceof Error ? e.message : String(e)
      toast({ level: 'error', title: '文档保存失败', message })
    }
  }, [selectedNodeId, nodePath, currentDocumentKey, isDocumentDirty, draftContent, savedContent, handleSave])

  const isContentLoaded = useMemo(() => {
    if (!currentDocumentKey) return false
    return loadedDocumentKey === currentDocumentKey || detailEntry !== undefined
  }, [currentDocumentKey, detailEntry, loadedDocumentKey])

  useEffect(() => {
    saveRequestSeqRef.current += 1
    draftVersionRef.current = 0
    savedDraftVersionRef.current = 0
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
    if (!isActive || !selectedNodeId || !nodePath || !currentDocumentKey) return
    const readStartedAt = performance.now()

    const cachedContent = useCardContentStore.getState().detailEntries[currentDocumentKey]?.content
    if (cachedContent !== undefined) {
      setSavedContentState({ key: currentDocumentKey, content: cachedContent })
      setLoadedDocumentKey(currentDocumentKey)
      const cachedDrafts = useDraftStore.getState().detailDrafts
      const cachedDraft = cachedDrafts[currentDocumentKey]
      const cachedHasDraft = Object.prototype.hasOwnProperty.call(cachedDrafts, currentDocumentKey)
      if (!cachedHasDraft) {
        setDraftContent(currentDocumentKey, cachedContent)
        savedDraftVersionRef.current = draftVersionRef.current
        setIsDocumentDirty(false)
      } else {
        setIsDocumentDirty(!areDocumentContentsEqual(cachedDraft, cachedContent))
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

      const currentDraft = useDraftStore.getState().detailDrafts[currentDocumentKey]
      const hasCurrentDraft = Object.prototype.hasOwnProperty.call(useDraftStore.getState().detailDrafts, currentDocumentKey)
      const draftChangedDuringRead = draftVersionRef.current > 0
      if (!hasCurrentDraft || (!draftChangedDuringRead && areDocumentContentsEqual(currentDraft, cachedContent))) {
        setDraftContent(currentDocumentKey, content)
        savedDraftVersionRef.current = draftVersionRef.current
        setIsDocumentDirty(false)
      } else {
        setIsDocumentDirty(!areDocumentContentsEqual(currentDraft, content))
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
      setLoadedDocumentKey(currentDocumentKey)

      // Keep a local draft visible and dirty when the remote read fails. Clearing the
      // saved baseline here would make a failed read look like a successful empty load.
      if (!hasDraft) {
        setIsDocumentDirty(false)
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
  }, [isActive, selectedNodeId, nodePath, activeDocumentPath, currentDocumentKey, activeTopoDocumentId, storage, setDraftContent, setDetailContent])

  useEffect(() => {
    if (currentDocumentKey && detailEntry) {
      setSavedContentState({ key: currentDocumentKey, content: detailEntry.content })
    }
  }, [detailEntry, currentDocumentKey])

  // The previous session's cleanup closes over its own document key and draft
  // snapshot. Flush it before React switches this hook to another node/document
  // so a rapid selection change cannot silently discard the old dirty draft.
  useEffect(() => {
    return () => {
      void flushDocumentSave()
    }
  }, [currentDocumentKey])

  const flushDocumentSaveRef = useRef(flushDocumentSave)
  flushDocumentSaveRef.current = flushDocumentSave
  const isDocumentDirtyRef = useRef(isDocumentDirty)
  isDocumentDirtyRef.current = isDocumentDirty

  useEffect(() => {
    return registerTabSaver(tabId, async () => {
      await flushDocumentSaveRef.current()
    }, () => isDocumentDirtyRef.current)
  }, [tabId])

  const handleDraftChange = useCallback((value: unknown) => {
    if (!currentDocumentKey) return
    draftVersionRef.current += 1
    setDraftContent(currentDocumentKey, value)
    setIsDocumentDirty(true)
  }, [currentDocumentKey, setDraftContent])

  // AI 写入闸：把「当前文档是否正有未保存草稿」登记到外部写入总线。
  // 脏草稿存在时 AgentPatch 的预览阶段就会阻断，绝不靠静默合并去赌。
  useEffect(() => {
    markDocumentDirty(activeTopoDocumentId, isDocumentDirty)
    return () => markDocumentDirty(activeTopoDocumentId, false)
  }, [activeTopoDocumentId, isDocumentDirty])

  // AI 写盘成功后认领全新基线：draft / saved / detail cache 同步换成新内容，
  // 编辑器宿主按同一 revision 重挂载，于是下一次 autosave 拿到的已是新正文。
  useEffect(() => {
    if (!activeTopoDocumentId) {
      adoptedExternalRevisionRef.current = { docId: null, revision: -1 }
      return
    }
    if (adoptedExternalRevisionRef.current.docId !== activeTopoDocumentId) {
      // 首次见到这份文档只记基线；历史内容由正常的读盘链路负责加载。
      adoptedExternalRevisionRef.current = { docId: activeTopoDocumentId, revision: externalRevision }
      return
    }
    if (externalRevision <= adoptedExternalRevisionRef.current.revision) return
    adoptedExternalRevisionRef.current.revision = externalRevision
    const event = getDocumentExternalWrite(activeTopoDocumentId)
    if (!event || !currentDocumentKey) return
    setDetailContent(currentDocumentKey, event.content)
    setDraftContent(currentDocumentKey, event.content)
    setSavedContentState({ key: currentDocumentKey, content: event.content })
    setIsDocumentDirty(false)
    savedDraftVersionRef.current = draftVersionRef.current
  }, [externalRevision, activeTopoDocumentId, currentDocumentKey, setDetailContent, setDraftContent])

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
