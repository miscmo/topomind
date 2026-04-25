import { useEffect, useRef } from 'react'
import { useAppStore } from '../stores/appStore'
import { useNavContext } from './useNavContext'
import { useGraph } from './useGraph'
import { usePageLogging } from './usePageLogging'
import { useRoomLoader } from './useRoomLoader'
import { useTabDirtySync } from './useTabDirtySync'
import { registerTabSaver } from '../core/close-guard'

export interface UseGraphPageControllerOptions {
  tabId?: string
}

export function useGraphPageController({ tabId }: UseGraphPageControllerOptions) {
  const { getNavState } = useNavContext({ tabId })
  const nav = getNavState()
  const graph = useGraph(tabId)
  const view = useAppStore((s) => s.view)

  usePageLogging({
    view,
    effectiveRoomPath: nav.roomPath || null,
    effectiveKbPath: nav.kbPath || null,
    tabId,
  })

  useTabDirtySync({
    tabId,
    onDirtyChange: graph.onDirtyChange,
  })

  const graphHighlightRef = useRef(graph.highlightSearch)
  graphHighlightRef.current = graph.highlightSearch

  useRoomLoader({
    effectiveRoomPath: nav.roomPath || null,
    effectiveKbPath: nav.kbPath || null,
    tabId,
    loadRoom: graph.loadRoom,
    isCreatingRef: graph.isCreatingRef,
  })

  useEffect(() => {
    graphHighlightRef.current(nav.searchQuery)
  }, [nav.searchQuery])

  const flushCurrentRoomSaveRef = useRef(graph.flushCurrentRoomSave)
  flushCurrentRoomSaveRef.current = graph.flushCurrentRoomSave

  useEffect(() => {
    if (!tabId) return
    return registerTabSaver(tabId, async () => {
      await flushCurrentRoomSaveRef.current()
    })
  }, [tabId])

  return { nav, graph, view }
}
