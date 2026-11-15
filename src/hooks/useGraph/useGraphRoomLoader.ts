import { useCallback, useRef } from 'react'
import type { Store } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { logPerformanceMetric, PERFORMANCE_METRICS } from '../../core/performance-log'
import { loadRoomGraph } from './roomLoader'
import type { GraphSession } from '../../stores/tabs/tabStore'
import { replaceGraphSession, type GraphState, type GraphStoreApi } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

interface UseGraphRoomLoaderOptions {
  storage: Store
  getActiveGraphSession: () => GraphSession
  storeApi: StoreApi<GraphState>
  currentLoadedRoomPathRef: { current: string }
}

/** loadRoomGraph 的结果类型：并发去重的 in-flight Map 用它避免 any。 */
type LoadedRoomGraph = Awaited<ReturnType<typeof loadRoomGraph>>

/** 同一房间并发加载的读盘 key；不同知识库即使同名房间也不共享。 */
function graphCacheKey(kbPath: string, dirPath: string): string {
  return `${kbPath}\u0000${dirPath}`
}

export function useGraphRoomLoader(options: UseGraphRoomLoaderOptions) {
  const {
    storage,
    getActiveGraphSession,
    storeApi,
    currentLoadedRoomPathRef,
  } = options
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)
  /**
   * 同房间的并发加载共享一次 loadRoomGraph：旧实现让每个请求都完整读盘 +
   * O(N+E) 构建，再在完成后按 requestSeq 丢弃，白白耗费数百毫秒。
   */
  const inflightGraphRef = useRef(new Map<string, Promise<LoadedRoomGraph>>())

  const loadRoom = useCallback(
    async (dirPath: string, preserveCurrentNodeLayout = false) => {
      const startedAt = performance.now()
      const requestSeq = ++loadRequestSeqRef.current
      const store = storeApi.getState()
      const layoutStartedAt = performance.now()
      const currentNodeLayout = preserveCurrentNodeLayout
        ? new Map(store.nodes.map((node) => [node.id, {
            position: node.position,
            width: node.width,
            height: node.height,
          }]))
        : null
      const layoutMs = Math.round(performance.now() - layoutStartedAt)
      store.setLoading(true)

      try {
        const kbPath = getActiveGraphSession().kbPath
        const readStartedAt = performance.now()
        const key = graphCacheKey(kbPath, dirPath)
        let graphPromise = inflightGraphRef.current.get(key)
        const graphShared = graphPromise !== undefined
        if (!graphPromise) {
          graphPromise = loadRoomGraph(storage, dirPath, kbPath)
          inflightGraphRef.current.set(key, graphPromise)
          const tracked = graphPromise
          // 成功 / 失败都要清理；用 then(ok, fail) 而不是 finally，避免产生未处理的 rejection。
          void tracked.then(
            () => { if (inflightGraphRef.current.get(key) === tracked) inflightGraphRef.current.delete(key) },
            () => { if (inflightGraphRef.current.get(key) === tracked) inflightGraphRef.current.delete(key) },
          )
        }
        const loaded = await graphPromise
        const readMs = Math.round(performance.now() - readStartedAt)

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq, graphShared })

        if (requestSeq < loadRequestSeqRef.current) {
          // 被更新的请求取代 ≠ 失败。旧实现把它上报成 success:false 的性能样本，
          // 让房间加载的失败率虚高到 16.5%；这里只留普通日志用于排查时序。
          logAction('房间:加载丢弃', 'useGraph', {
            roomPath: dirPath,
            kbPath,
            requestSeq,
            supersededBy: loadRequestSeqRef.current,
            waitMs: Math.round(performance.now() - startedAt),
          })
          return
        }

        const applyStartedAt = performance.now()
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
        replaceGraphSession(storeApi as GraphStoreApi, nextNodes, loaded.edges, {
          x: loaded.meta.viewport.pan.x,
          y: loaded.meta.viewport.pan.y,
          zoom: loaded.meta.viewport.zoom,
        })
        currentLoadedRoomPathRef.current = dirPath
        store.setLoading(false)
        const applyMs = Math.round(performance.now() - applyStartedAt)

        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
          layoutMs,
          readMs,
          applyMs,
        })
        void logPerformanceMetric(PERFORMANCE_METRICS.roomLoad, performance.now() - startedAt, {
          success: true,
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
          preserveCurrentNodeLayout,
          // 分阶段耗时：后续可据此判断慢在读盘 / 构建还是状态替换，不用猜。
          layoutMs,
          readMs,
          applyMs,
          graphShared,
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
    [currentLoadedRoomPathRef, storage, getActiveGraphSession, storeApi]
  )

  return { loadRoom }
}
