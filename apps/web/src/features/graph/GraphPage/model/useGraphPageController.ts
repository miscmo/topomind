/**
 * GraphPage 页面控制器
 * 编排 useGraphSession / useGraph，以及页面级副作用。
 */
import { useEffect, useRef } from 'react'
import { useGraph } from '../../../../hooks/useGraph'
import { useGraphSession } from '../../../../stores/tabs/tabStore'
import { registerTabSaver } from '../../../../core/close-guard'
import { logAction } from '../../../../core/log-backend'

export interface UseGraphPageControllerOptions {
  tabId: string
}

export function useGraphPageController({ tabId }: UseGraphPageControllerOptions) {
  const graphSession = useGraphSession(tabId)
  const effectiveRoomId = graphSession.roomId || null
  const graph = useGraph(tabId)
  const effectiveKbId = graphSession.kbId || null
  const effectiveRoomRef = graphSession.roomRef || null

  useEffect(() => {
    logAction('页面:进入图谱', 'GraphPage', {
      currentRoomId: effectiveRoomId || '',
      currentKBId: effectiveKbId || '',
      currentRoomRef: effectiveRoomRef || '',
      tabId,
    })
  }, [effectiveRoomId, effectiveKbId, effectiveRoomRef, tabId])

  const loadRoomRef = useRef(graph.loadRoom)
  loadRoomRef.current = graph.loadRoom

  useEffect(() => {
    if (!effectiveRoomRef) return

    const capturedRoomId = effectiveRoomId || ''
    const capturedKBId = effectiveKbId || ''
    const capturedRoomRef = effectiveRoomRef || ''
    const capturedTabId = tabId

    queueMicrotask(() => {
      if (graph.isCreatingRef.current) {
        graph.isCreatingRef.current = false
        return
      }
      logAction('房间:加载触发', 'GraphPage', {
        roomRef: capturedRoomRef,
        currentRoomId: capturedRoomId,
        currentKBId: capturedKBId,
        tabId: capturedTabId,
      })
      loadRoomRef.current(capturedRoomRef)
    })
  }, [effectiveRoomId, effectiveKbId, effectiveRoomRef, tabId, graph.isCreatingRef])

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
