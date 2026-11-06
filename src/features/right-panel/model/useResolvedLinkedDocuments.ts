import { useEffect, useState } from 'react'
import { useStorage } from '../../../core/storage'
import type { LinkedDocumentRef, ResolvedLinkedDocument } from '../../../domain/graph/linkedDocuments'
import { syncLinkedDocumentsToGraph } from '../../graph/linkedDocumentStore'

interface Options {
  nodeId: string | null
  /** 当前节点的完整 cardPath，关联字段就写在它的父房间 _graph.json 里 */
  nodePath: string | null
  links: LinkedDocumentRef[]
  /** 恢复回收站文档后 +1，强制重新解析 */
  refreshToken?: number
}

/**
 * 打开关联视图时批量解析 docId → 真实位置 / 标题 / 状态。
 * cardRef 只是缓存：文档被移动到别的节点后按 docId 全库自愈并回写，
 * 改标题也会自动刷新；删除进回收站则标记 trashed，清空回收站才是 missing。
 *
 * 空态与 loading 都从 requestKey 派生，effect 里不做同步 setState：
 * 避免 react-hooks/set-state-in-effect 的级联渲染，也避免切视图时闪一帧旧数据。
 */
export function useResolvedLinkedDocuments({ nodeId, nodePath, links, refreshToken = 0 }: Options) {
  const storage = useStorage()
  const [resolved, setResolved] = useState<ResolvedLinkedDocument[]>([])
  const [doneKey, setDoneKey] = useState<string | null>(null)
  const signature = links.map((link) => `${link.docId}|${link.cardRef}|${link.title}`).join(';')
  const requestKey = `${nodePath ?? ''}|${signature}|${refreshToken}`
  const isEmpty = !nodePath || links.length === 0

  useEffect(() => {
    if (isEmpty) return
    let cancelled = false
    void Promise.all(links.map(async (link): Promise<ResolvedLinkedDocument> => {
      try {
        const result = await storage.resolveDocumentById(link.docId, link.cardRef)
        return {
          ...link,
          status: result.status,
          cardPath: result.cardPath,
          title: result.status === 'missing' ? link.title : (result.title || link.title),
          type: result.type || 'smart',
          trashName: result.trashName,
          nodeName: result.nodeName,
          sourceLabel: result.sourceLabel || '未知位置',
        }
      } catch {
        return { ...link, status: 'missing', cardPath: '', type: 'smart', sourceLabel: '未知位置' }
      }
    })).then((list) => {
      if (cancelled) return
      setResolved(list)
      const healed = links.map((link, index) => {
        const item = list[index]
        if (item.status !== 'ok' || !item.cardPath || item.cardPath === link.cardRef) {
          return item.title !== link.title ? { ...link, title: item.title } : link
        }
        return { ...link, cardRef: item.cardPath, title: item.title }
      })
      if (healed.some((item, index) => item.cardRef !== links[index].cardRef || item.title !== links[index].title)) {
        void storage.updateNodeLinkedDocuments(nodePath, healed).then((saved) => {
          if (!cancelled && nodeId) syncLinkedDocumentsToGraph(nodeId, saved)
        }).catch(() => undefined)
      }
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setDoneKey(requestKey)
    })
    return () => { cancelled = true }
    // signature/requestKey 是 links 的稳定内容键，避免每次渲染的数组字面量触发重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodePath, signature, refreshToken, storage, isEmpty, requestKey])

  return {
    resolved: isEmpty ? [] : resolved,
    loading: !isEmpty && doneKey !== requestKey,
  }
}
