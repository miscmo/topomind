/**
 * GraphPage 页面控制器
 * 编排 usePageLogging / useTabDirtySync / useRoomLoader / useNavContext / useGraph
 * 等多个子模块，统一管理 GraphPage 的页面逻辑。
 */
import { useEffect, useRef } from 'react'
import { useNavContext } from '../../hooks/useNavContext'
import { useGraph } from '../../hooks/useGraph'
import { usePageLogging } from '../../hooks/usePageLogging'
import { useRoomLoader } from '../../hooks/useRoomLoader'
import { useTabDirtySync } from '../../hooks/useTabDirtySync'
import { registerTabSaver } from '../../core/close-guard'

export interface UseGraphPageControllerOptions {
  tabId: string
}

export function useGraphPageController({ tabId }: UseGraphPageControllerOptions) {
  const { nav } = useNavContext({ tabId })
  const graph = useGraph(tabId)

  usePageLogging({
    effectiveRoomPath: nav.roomPath || null,
    effectiveKbPath: nav.kbPath || null,
    tabId,
  })

  useTabDirtySync({
    tabId,
    onDirtyChange: graph.onDirtyChange,
  })

  useRoomLoader({
    effectiveRoomPath: nav.roomPath || null,
    effectiveKbPath: nav.kbPath || null,
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

  return { nav, graph }
}
