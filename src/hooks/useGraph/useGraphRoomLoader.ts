import { useCallback, useRef } from 'react'
import type { Store } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
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
    async (dirPath: string) => {
      const requestSeq = ++loadRequestSeqRef.current
      const store = storeApi.getState()
      store.setLoading(true)

      try {
        const kbPath = getActiveGraphSession().kbPath
        const loaded = await loadRoomGraph(storage, dirPath, kbPath)

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        store.setGraph(loaded.nodes, loaded.edges, {
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
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          storeApi.getState().setLoading(false)
        }
      }
    },
    [storage, getActiveGraphSession, storeApi]
  )

  return { loadRoom }
}
