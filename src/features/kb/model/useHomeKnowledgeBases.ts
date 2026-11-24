import { useCallback, useEffect, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { logAction } from '../../../core/log-backend'
import { PERFORMANCE_METRICS, startPerformanceSpan } from '../../../core/performance-log'
import { logger } from '../../../core/logger'
import { tabStore } from '../../../stores/tabs/tabStore'

export interface KBItem {
  name: string
  nodeCount: number | null
  coverUrl: string | null
  coverOffset?: number
}

/** 开库日志的轻量摘要，见 toKBLogInfo。 */
export interface KBLogInfo {
  kbName: string
  nodeCount: number | null
  hasCover: boolean
  coverBytes: number
}

/**
 * KBItem.coverUrl 是整张封面图的 base64 data URI（实测单张 6.5~8.3 MB）。
 * 早期直接把 kb 对象写进 params，一次点击要经历两遍 8MB 序列化 + IPC + 写盘 +
 * 广播，11-21 单日 494MB 日志几乎全部来自这里，且伴随主线程长任务。
 * 日志只需要「哪个库 / 有没有封面 / 封面多大」这类可诊断元数据。
 */
export function toKBLogInfo(kb: KBItem): KBLogInfo {
  return {
    kbName: kb.name,
    nodeCount: kb.nodeCount,
    hasCover: Boolean(kb.coverUrl),
    coverBytes: kb.coverUrl?.length ?? 0,
  }
}

const HOME_KB_IO_CONCURRENCY = 6

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }))
  return results
}

interface UseHomeKnowledgeBasesOptions {
  currentWorkDir: string | null
  setMessage: (message: string) => void
  setMessageError: (isError: boolean) => void
}

export function useHomeKnowledgeBases(options: UseHomeKnowledgeBasesOptions) {
  const { currentWorkDir, setMessage, setMessageError } = options
  const storage = useStorage()
  const [loading, setLoading] = useState(false)
  const [kbs, setKbs] = useState<KBItem[]>([])
  const requestSeqRef = useRef(0)
  const latestKbsRef = useRef<KBItem[]>([])
  const confirmedOrderRef = useRef<string[]>([])
  const latestOrderRef = useRef<string[]>([])
  const reorderSeqRef = useRef(0)
  const reorderQueueRef = useRef(Promise.resolve())

  const loadKBList = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current
    const isCurrentRequest = () => requestSeqRef.current === requestSeq
    const perfSpan = startPerformanceSpan(PERFORMANCE_METRICS.kbListLoad, {
      module: 'HomePage',
      params: { workDir: currentWorkDir },
    })
    let perfError: unknown = null
    setLoading(true)
    try {
      const list = await storage.listKBs()
      logAction('kb.list_load', 'HomePage', {
        workDir: currentWorkDir,
        kbCount: (list || []).length,
        list: list,
      })

      const kbList = [...(list || [])]
      const config = await storage.readConfig()
      const kbCovers = config.kbCovers || {}
      const kbOrder = config.kbOrder || []
      confirmedOrderRef.current = [...kbOrder]
      latestOrderRef.current = [...kbOrder]

      // Sort according to kbOrder
      const orderMap = new Map(kbOrder.map((name, i): [string, number] => [name, i]))
      kbList.sort((a, b) => {
        const orderA = orderMap.has(a.name) ? orderMap.get(a.name)! : Infinity
        const orderB = orderMap.has(b.name) ? orderMap.get(b.name)! : Infinity
        if (orderA !== orderB) return orderA - orderB
        return a.name.localeCompare(b.name, 'zh-CN')
      })

      const initial: KBItem[] = await mapWithConcurrency(kbList, HOME_KB_IO_CONCURRENCY, async (kb) => {
        let coverUrl = null
        if (kbCovers[kb.name]) {
          try {
            coverUrl = await storage.readAttachmentDataUrl('__ROOT__', kbCovers[kb.name])
          } catch {
            // Ignore error
          }
        }
        return {
          name: kb.name,
          nodeCount: null,
          coverUrl,
          coverOffset: config.kbCoverOffsets?.[kb.name] ?? 50,
        }
      })
      if (!isCurrentRequest()) return
      latestKbsRef.current = initial
      setKbs(initial)

      const counts = await mapWithConcurrency(
        initial,
        HOME_KB_IO_CONCURRENCY,
        async (kb) => {
          try {
            return await storage.countChildren(kb.name)
          } catch (err) {
            logger.catch('HomePage', 'loadKBList:countChildren', err)
            logAction('kb.list_load_failed', 'HomePage', {
              kbName: kb.name,
              error: err instanceof Error ? err.message : String(err),
            })
            return 0
          }
        }
      )
      if (!isCurrentRequest()) return
      const completed = initial.map((kb, i) => ({ ...kb, nodeCount: counts[i] }))
      latestKbsRef.current = completed
      setKbs(completed)
      logAction('kb.node_count_load', 'HomePage', { totalNodes: counts.reduce((a, b) => a + b, 0) })
    } catch (err) {
      perfError = err
      const msg = err instanceof Error ? err.message : String(err)
      logger.catch('HomePage', 'loadKBList', err)
      logAction('kb.list_load_failed', 'HomePage', { error: msg })
      if (isCurrentRequest()) {
        setMessage(msg || '加载知识库列表失败')
        setMessageError(true)
      }
    } finally {
      if (perfError) perfSpan.fail(perfError)
      else perfSpan.end({ kbCount: latestKbsRef.current.length })
      if (isCurrentRequest()) setLoading(false)
    }
  }, [currentWorkDir, setMessage, setMessageError, storage])

  useEffect(() => {
    loadKBList()
  }, [loadKBList])

  const openKB = useCallback(async (kb: KBItem) => {
    const opened = tabStore.getState().openKnowledgeBase(kb)
    if (!opened) return
    logAction('kb.open', 'HomePage', { kbInfo: toKBLogInfo(kb) })
  }, [])

  const refreshKBList = useCallback(async () => {
    await loadKBList()
  }, [loadKBList])

  const reorderKBs = useCallback((newOrder: string[]) => {
    const previous = latestKbsRef.current.length > 0 ? latestKbsRef.current : kbs
    const requestSeq = ++reorderSeqRef.current
    const nextOrder = [...newOrder]
    const reordered = [...previous].sort((a, b) => {
      const orderA = nextOrder.indexOf(a.name)
      const orderB = nextOrder.indexOf(b.name)
      return (orderA !== -1 ? orderA : Infinity) - (orderB !== -1 ? orderB : Infinity)
    })
    latestOrderRef.current = nextOrder
    latestKbsRef.current = reordered
    setKbs(reordered)

    reorderQueueRef.current = reorderQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const config = await storage.readConfig()
        config.kbOrder = latestOrderRef.current
        await storage.writeConfig(config)
        confirmedOrderRef.current = [...latestOrderRef.current]
        logAction('kb.sort', 'HomePage', { newOrder: latestOrderRef.current })
      })
      .catch((err) => {
        logger.catch('HomePage', 'reorderKBs', err)
        if (requestSeq === reorderSeqRef.current) {
          latestOrderRef.current = [...confirmedOrderRef.current]
          const restored = [...previous].sort((a, b) => {
            const orderA = latestOrderRef.current.indexOf(a.name)
            const orderB = latestOrderRef.current.indexOf(b.name)
            return (orderA !== -1 ? orderA : Infinity) - (orderB !== -1 ? orderB : Infinity)
          })
          latestKbsRef.current = restored
          setKbs(restored)
          setMessage('知识库排序保存失败，已恢复原顺序')
          setMessageError(true)
        }
      })
  }, [kbs, setMessage, setMessageError, storage])

  return {
    loading,
    kbs,
    openKB,
    refreshKBList,
    reorderKBs,
  }
}
