import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../../../core/storage'
import type { DocumentBacklink } from '../../../domain/graph/linkedDocuments'

interface BacklinkResult {
  key: string
  items: DocumentBacklink[]
}

/**
 * 「被引用」列表：只在右栏切到该页、且确实有活动文档时才打 IPC 做全库扫描。
 * 与主进程 docId 反查一致，不建常驻索引；切换文档或手动 refresh 都会重扫。
 *
 * loading / items 由「当前请求 key」与「已完成结果 key」派生，effect 体内不做
 * 同步 setState（React 19 的 set-state-in-effect 会报），所有写入都发生在异步回调里。
 */
export function useDocumentBacklinks(docId: string | null, enabled: boolean) {
  const storage = useStorage()
  const [result, setResult] = useState<BacklinkResult | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const requestKey = enabled && docId ? `${docId}|${tick}` : ''
  const loading = Boolean(requestKey) && result?.key !== requestKey
  const items = requestKey && result?.key === requestKey ? result.items : []

  useEffect(() => {
    if (!requestKey || !docId) return
    let cancelled = false
    const key = requestKey
    void storage.listDocumentBacklinks(docId)
      .then((list) => { if (!cancelled) setResult({ key, items: list }) })
      .catch((error) => {
        if (cancelled) return
        console.error('[document-backlinks] 扫描反向链接失败', error)
        setResult({ key, items: [] })
      })
    return () => { cancelled = true }
  }, [docId, requestKey, storage])

  return { items, loading, refresh }
}
