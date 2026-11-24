/**
 * GraphPage 页面控制器
 * 编排 useGraphSession / useGraph，以及页面级副作用。
 */
import { useEffect, useRef } from 'react'
import { useGraph } from '../../../../hooks/useGraph'
import { useGraphSession } from '../../../../stores/tabs/tabStore'
import { registerTabSaver } from '../../../../core/close-guard'
import { logAction } from '../../../../core/log-backend'
import { recordStep } from '../../../../core/traceBuffer'
import { useRoomHistoryTracker } from '../../../../hooks/useRoomHistory'

export interface UseGraphPageControllerOptions {
  tabId: string
}

export function useGraphPageController({ tabId }: UseGraphPageControllerOptions) {
  const graphSession = useGraphSession(tabId)
  const graph = useGraph(tabId)
  const effectiveRoomPath = graphSession.roomPath || null
  const effectiveKbPath = graphSession.kbPath || null

  useRoomHistoryTracker(tabId)

  useEffect(() => {
    logAction('graph.page_enter', 'GraphPage', {
      currentRoomPath: effectiveRoomPath || '',
      currentKBPath: effectiveKbPath || '',
      tabId,
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId])

  const loadRoomRef = useRef(graph.loadRoom)
  loadRoomRef.current = graph.loadRoom

  useEffect(() => {
    const loadPath = effectiveRoomPath || effectiveKbPath || ''
    if (!loadPath) return

    const capturedTabId = tabId

    queueMicrotask(() => {
      if (graph.isCreatingRef.current) {
        graph.isCreatingRef.current = false
        return
      }
      // P7：发起加载是入口步骤，room.load 的唯一落盘产生点在 useGraphRoomLoader 的应用完成处。
      recordStep({ name: 'room.load.request', outcome: 'requested', params: { loadPath, tabId: capturedTabId } })
      loadRoomRef.current(loadPath)
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId, graph.isCreatingRef])

  const flushCurrentRoomSaveRef = useRef(graph.flushCurrentRoomSave)
  flushCurrentRoomSaveRef.current = graph.flushCurrentRoomSave
  const hasPendingCurrentRoomSaveRef = useRef(graph.hasPendingCurrentRoomSave)
  hasPendingCurrentRoomSaveRef.current = graph.hasPendingCurrentRoomSave

  useEffect(() => {
    return registerTabSaver(tabId, async () => {
      await flushCurrentRoomSaveRef.current()
    }, () => hasPendingCurrentRoomSaveRef.current())
  }, [tabId])

  return { graphSession, graph }
}
