import { useEffect, useState } from 'react'
import type { FSBDocumentCandidate } from '../../../core/fs-backend'
import type { UnifiedTreeDataSource } from './types'

const SEARCH_DEBOUNCE_MS = 200

/**
 * 树形浏览之外的搜索通道：空 query 完全不请求（这是「打开控件不扫全库」的关键），
 * 输入后 debounce 才走主进程派生索引；旧结果会被取消，不会覆盖新输入。
 */
export function useUnifiedTreeSearch(dataSource: UnifiedTreeDataSource, limit = 80) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FSBDocumentCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setLoading(false)
      setError(null)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      void dataSource.search(q, limit)
        .then((list) => {
          if (cancelled) return
          setResults(Array.isArray(list) ? list : [])
          setLoading(false)
        })
        .catch((cause) => {
          if (cancelled) return
          setError((cause as Error)?.message || String(cause))
          setResults([])
          setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, dataSource, limit])

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    isSearching: query.trim().length > 0,
  }
}
