import { useCallback, useRef } from 'react'
import type { Store } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS } from '../../core/performance-log'
import { loadRoomGraph } from './roomLoader'
import type { GraphSession } from '../../stores/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

interface UseGraphRoomLoaderOptions {
  storage: Store
  getActiveGraphSession: () => GraphSession
  storeApi: StoreApi<GraphState>
}

export function useGraphRoomLoader(options: UseGraphRoomLoaderOptions) {
  const {
    storage,
    getActiveGraphSession,
    storeApi,
  } = options
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)

  const loadRoom = useCallback(
    async (dirPath: string, preserveCurrentNodeLayout = false) => {
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
        const kbPath = getActiveGraphSession().kbPath
        const loaded = await loadRoomGraph(storage, dirPath, kbPath)

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
            success: false,
            roomPath: dirPath,
            kbPath,
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
        store.setLoading(false)
        
        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
        })
        void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
          success: true,
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
          preserveCurrentNodeLayout,
        }, 'useGraph')
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
          success: false,
          roomPath: dirPath,
          preserveCurrentNodeLayout,
          requestSeq,
          error: e instanceof Error ? e.message : String(e),
        }, 'useGraph')
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          storeApi.getState().setLoading(false)
        }
      }
    },
    [storage, getActiveGraphSession, storeApi]
  )

  return { loadRoom }
}
