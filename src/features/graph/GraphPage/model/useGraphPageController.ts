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
  const graph = useGraph(tabId)
  const effectiveRoomPath = graphSession.roomPath || null
  const effectiveKbPath = graphSession.kbPath || null

  useEffect(() => {
    logAction('页面:进入图谱', 'GraphPage', {
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

    const capturedRoomPath = effectiveRoomPath || ''
    const capturedKBPath = effectiveKbPath || ''
    const capturedTabId = tabId

    queueMicrotask(() => {
      if (graph.isCreatingRef.current) {
        graph.isCreatingRef.current = false
        return
      }
      logAction('房间:加载触发', 'GraphPage', {
        loadPath,
        currentRoomPath: capturedRoomPath,
        currentKBPath: capturedKBPath,
        tabId: capturedTabId,
      })
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
