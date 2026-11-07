import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../../../core/storage'
import type { DocumentRelations } from '../../../domain/graph/linkedDocuments'

interface RelationResult {
  key: string
  relations: DocumentRelations
}

const EMPTY_RELATIONS: DocumentRelations = {
  incoming: [],
  outgoing: [],
  parsed: 0,
  indexed: 0,
}

/**
 * 「引用关系」页：只在右栏切到该页、且确实有活动文档时才打 IPC。
 * 主进程用派生关系索引 + 文件签名自愈，二次查询不再读全库正文；出入链由一次
 * 查询同时返回，上下两栏共用，不会各扫一遍。刷新只需重新请求，签名变化的正文
 * 会被主进程自动重解析，无需渲染层操心缓存失效。
 *
 * loading / relations 由「当前请求 key」与「已完成结果 key」派生，effect 体内不做
 * 同步 setState（React 19 的 set-state-in-effect 会报），写入都在异步回调里。
 */
export function useDocumentRelations(docId: string | null, enabled: boolean) {
  const storage = useStorage()
  const [result, setResult] = useState<RelationResult | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const requestKey = enabled && docId ? `${docId}|${tick}` : ''
  const loading = Boolean(requestKey) && result?.key !== requestKey
  const relations = requestKey && result?.key === requestKey ? result.relations : EMPTY_RELATIONS

  useEffect(() => {
    if (!requestKey || !docId) return
    let cancelled = false
    const key = requestKey
    void storage.listDocumentRelations(docId)
      .then((next) => { if (!cancelled) setResult({ key, relations: next }) })
      .catch((error) => {
        if (cancelled) return
        console.error('[document-relations] 查询引用关系失败', error)
        setResult({ key, relations: EMPTY_RELATIONS })
      })
    return () => { cancelled = true }
  }, [docId, requestKey, storage])

  return { ...relations, loading, refresh }
}
