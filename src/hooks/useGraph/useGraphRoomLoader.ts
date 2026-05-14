import { useCallback, useRef } from 'react'
import type { Store } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { loadRoomGraph } from './roomLoader'
import type { GraphSession } from '../../stores/tabStore'
import { useGraphStore } from '../../stores/graphStore'

interface UseGraphRoomLoaderOptions {
  storage: Store
  getActiveGraphSession: () => GraphSession
}

export function useGraphRoomLoader(options: UseGraphRoomLoaderOptions) {
  const {
    storage,
    getActiveGraphSession,
  } = options
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)

  const loadRoom = useCallback(
    async (dirPath: string) => {
      const requestSeq = ++loadRequestSeqRef.current
      const store = useGraphStore.getState()
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
        store.setGraph(loaded.nodes, loaded.edges)
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
          useGraphStore.getState().setLoading(false)
        }
      }
    },
    [storage, getActiveGraphSession]
  )

  return { loadRoom }
}
