import { useCallback, useRef } from 'react'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS } from '../../core/performance-log'
import { loadRoomGraph, type RoomLoaderStorage } from './roomLoader'
import type { GraphSession } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

interface UseGraphRoomLoaderOptions {
  storage: RoomLoaderStorage
  getActiveGraphSession: () => GraphSession
  storeApi: StoreApi<GraphState>
  currentLoadedRoomRef: { current: string }
}

export function useGraphRoomLoader(options: UseGraphRoomLoaderOptions) {
  const {
    storage,
    getActiveGraphSession,
    storeApi,
    currentLoadedRoomRef,
  } = options
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)

  const loadRoom = useCallback(
    async (roomRef: string, preserveCurrentNodeLayout = false) => {
      const startedAt = performance.now()
      const requestSeq = ++loadRequestSeqRef.current
      const store = storeApi.getState()
      const currentNodeLayout = preserveCurrentNodeLayout
        ? new Map(store.nodes.map((node) => [node.id, {
            position: node.position,
            width: node.width,
            height: node.height,
          }]))
        : null
      store.setLoading(true)

      try {
        const kbId = getActiveGraphSession().kbId
        const loaded = await loadRoomGraph(storage, roomRef, kbId)

        logAction('房间:加载', 'useGraph', { roomRef, kbId, requestSeq })

        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomRef, kbId, requestSeq })
          void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
            success: false,
            roomRef,
            kbId,
            requestSeq,
            preserveCurrentNodeLayout,
            discarded: true,
          }, 'useGraph')
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        const nextNodes = currentNodeLayout
          ? loaded.nodes.map((node) => {
              const current = currentNodeLayout.get(node.id)
              if (!current) return node
              return {
                ...node,
                position: current.position,
                width: current.width ?? node.width,
                height: current.height ?? node.height,
              }
            })
          : loaded.nodes
        store.setGraph(nextNodes, loaded.edges, {
          x: loaded.meta.viewport.pan.x,
          y: loaded.meta.viewport.pan.y,
          zoom: loaded.meta.viewport.zoom,
        })
        currentLoadedRoomRef.current = roomRef
        store.setLoading(false)
        
        logAction('房间:加载完成', 'useGraph', {
          roomRef,
          kbId,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
        })
        void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
          success: true,
          roomRef,
          kbId,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
          preserveCurrentNodeLayout,
        }, 'useGraph')
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
          success: false,
          roomRef,
          preserveCurrentNodeLayout,
          requestSeq,
          error: e instanceof Error ? e.message : String(e),
        }, 'useGraph')
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          storeApi.getState().setLoading(false)
        }
      }
    },
    [currentLoadedRoomRef, storage, getActiveGraphSession, storeApi]
  )

  return { loadRoom }
}
