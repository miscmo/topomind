/**
 * GraphPage 页面控制器
 * 编排 useGraphPageLogging / useGraphPageRoomLoader / useGraphSession / useGraph
 * 等多个子模块，统一管理 GraphPage 的页面逻辑。
 */
import { useEffect, useRef } from 'react'
import { useGraph } from '../../hooks/useGraph'
import { useGraphSession } from '../../stores/tabStore'
import { registerTabSaver } from '../../core/close-guard'
import { useGraphPageRoomLoader } from './useGraphPageRoomLoader'
import { useGraphPageLogging } from './useGraphPageLogging'

export interface UseGraphPageControllerOptions {
  tabId: string
}

export function useGraphPageController({ tabId }: UseGraphPageControllerOptions) {
  const graphSession = useGraphSession(tabId)
  const graph = useGraph(tabId)

  useGraphPageLogging({
    effectiveRoomPath: graphSession.roomPath || null,
    effectiveKbPath: graphSession.kbPath || null,
    tabId,
  })

  useGraphPageRoomLoader({
    effectiveRoomPath: graphSession.roomPath || null,
    effectiveKbPath: graphSession.kbPath || null,
    tabId,
    loadRoom: graph.loadRoom,
    isCreatingRef: graph.isCreatingRef,
  })

  const flushCurrentRoomSaveRef = useRef(graph.flushCurrentRoomSave)
  flushCurrentRoomSaveRef.current = graph.flushCurrentRoomSave

  useEffect(() => {
    return registerTabSaver(tabId, async () => {
      await flushCurrentRoomSaveRef.current()
    })
  }, [tabId])

  return { graphSession, graph }
}
