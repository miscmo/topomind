import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../../core/storage'
import { logAction } from '../../core/log-backend'
import { logger } from '../../core/logger'
import { tabStore } from '../../stores/tabStore'

export interface KBItem {
  name: string
  nodeCount: number | null
  coverUrl: string | null
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

  const loadKBList = useCallback(async () => {
    setLoading(true)
    try {
      const list = await storage.listKBs()
      logAction('HomePage:知识库列表加载成功', 'HomePage', {
        workDir: currentWorkDir,
        kbCount: (list || []).length,
        list: list,
      })

      const kbList = list || []
      const config = await storage.readConfig()
      const kbCovers = config.kbCovers || {}
      const kbOrder = config.kbOrder || []

      // Sort according to kbOrder
      const orderMap = new Map(kbOrder.map((name, i) => [name, i]))
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
          } catch (e) {
            // Ignore error
          }
        }
        return {
          name: kb.name,
          nodeCount: null,
          coverUrl,
        }
      })
      setKbs(initial)

      const counts = await mapWithConcurrency(
        initial,
        HOME_KB_IO_CONCURRENCY,
        async (kb) => {
          try {
            return await storage.countChildren(kb.name)
          } catch (err) {
            logger.catch('HomePage', 'loadKBList:countChildren', err)
            logAction('HomePage:统计子节点异常', 'HomePage', {
              kbName: kb.name,
              error: err instanceof Error ? err.message : String(err),
            })
            return 0
          }
        }
      )
      setKbs(initial.map((kb, i) => ({ ...kb, nodeCount: counts[i] })))
      logAction('HomePage:子节点数量加载完成', 'HomePage', { totalNodes: counts.reduce((a, b) => a + b, 0) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.catch('HomePage', 'loadKBList', err)
      logAction('HomePage:加载知识库列表异常', 'HomePage', { error: msg })
      setMessage(msg || '加载知识库列表失败')
      setMessageError(true)
    } finally {
      setLoading(false)
    }
  }, [currentWorkDir, setMessage, setMessageError, storage])

  useEffect(() => {
    loadKBList()
  }, [loadKBList])

  const openKB = useCallback(async (kb: KBItem) => {
    const opened = tabStore.getState().openKnowledgeBase(kb)
    if (!opened) return
    logAction('打开知识库成功', 'HomePage', { kbInfo: kb })
  }, [])

  const refreshKBList = useCallback(async () => {
    await loadKBList()
  }, [loadKBList])

  return {
    loading,
    kbs,
    openKB,
    refreshKBList,
  }
}
