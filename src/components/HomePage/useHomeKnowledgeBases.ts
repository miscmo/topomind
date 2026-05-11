import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../../hooks/useStorage'
import { logAction } from '../../core/log-backend'
import { logger } from '../../core/logger'
import { openKBTab } from '../../core/tab-flow'

export interface KBItem {
  path: string
  name: string
  nodeCount: number | null
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
      const initial: KBItem[] = kbList.map((kb) => ({
        path: kb.path,
        name: kb.name,
        nodeCount: null,
      }))
      setKbs(initial)

      const counts = await Promise.all(
        initial.map(async (kb) => {
          try {
            return await storage.countChildren(kb.path)
          } catch (err) {
            logger.catch('HomePage', 'loadKBList:countChildren', err)
            logAction('HomePage:统计子节点异常', 'HomePage', {
              kbPath: kb.path,
              kbName: kb.name,
              error: err instanceof Error ? err.message : String(err),
            })
            return 0
          }
        })
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
    const opened = await openKBTab(kb)
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
