import { useCallback, useEffect, useState } from 'react'
import { LocalDB } from '../../../core/localdb-backend'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { getCloudAttachmentLocalUrl } from '../../../core/cloud-attachment-cache'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../../../application/cloud/events'
import { tabStore } from '../../../stores/tabs/tabStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import type { LocalAttachmentRecord } from '../../../types/local-sync'

export interface KBItem {
  id: string
  name: string
  nodeCount: number | null
  coverUrl: string | null
  coverAttachmentId: string | null
  coverOffset?: number
}

interface UseHomeKnowledgeBasesOptions {
  setMessage: (message: string) => void
  setMessageError: (isError: boolean) => void
}

export function useHomeKnowledgeBases(options: UseHomeKnowledgeBasesOptions) {
  const { setMessage, setMessageError } = options
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [loading, setLoading] = useState(false)
  const [kbs, setKbs] = useState<KBItem[]>([])

  const resolveKnowledgeBaseCoverUrl = useCallback(
    async (
      workspaceId: string,
      coverAttachmentId: string | null,
      attachmentsById: Map<string, LocalAttachmentRecord>,
    ): Promise<string | null> => {
      if (!coverAttachmentId) {
        return null
      }
      const attachment = attachmentsById.get(coverAttachmentId)
      if (!attachment || attachment.deletedAt) {
        return null
      }
      try {
        return await getCloudAttachmentLocalUrl({
          workspaceId,
          attachmentId: attachment.id,
          fileName: attachment.fileName,
        })
      } catch (error) {
        logger.catch('HomePage', `resolveKnowledgeBaseCoverUrl:${coverAttachmentId}`, error)
        return null
      }
    },
    [],
  )

  const loadKBList = useCallback(async () => {
    setLoading(true)
    try {
      if (!currentWorkspaceId) {
        setKbs([])
        return
      }

      const snapshot = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
      const config = snapshot.config.configJson as {
        kbOrder?: string[]
        kbCoverOffsets?: Record<string, number>
      }
      const orderMap = new Map((config.kbOrder || []).map((name, index) => [name, index]))
      const nodeCountByKbId = new Map<string, number>()
      for (const card of snapshot.cards) {
        if (card.deletedAt) {
          continue
        }
        nodeCountByKbId.set(card.kbId, (nodeCountByKbId.get(card.kbId) ?? 0) + 1)
      }
      const attachmentsById = new Map(
        snapshot.attachments
          .filter((attachment) => !attachment.deletedAt)
          .map((attachment) => [attachment.id, attachment] as const),
      )

      const orderedKbs = snapshot.knowledgeBases
        .filter((kb) => !kb.deletedAt)
        .sort((a, b) => {
          const orderA = orderMap.has(a.name) ? orderMap.get(a.name)! : Infinity
          const orderB = orderMap.has(b.name) ? orderMap.get(b.name)! : Infinity
          if (orderA !== orderB) return orderA - orderB
          return a.name.localeCompare(b.name, 'zh-CN')
        })
      const localKbs: KBItem[] = await Promise.all(
        orderedKbs.map(async (kb) => ({
          id: kb.id,
          name: kb.name,
          nodeCount: nodeCountByKbId.get(kb.id) ?? 0,
          coverAttachmentId: kb.coverAttachmentId,
          coverUrl: await resolveKnowledgeBaseCoverUrl(
            currentWorkspaceId,
            kb.coverAttachmentId,
            attachmentsById,
          ),
          coverOffset: config.kbCoverOffsets?.[kb.name] ?? 50,
        })),
      )

      setKbs(localKbs)
      logAction('HomePage:知识库列表加载成功', 'HomePage', {
        workspaceId: currentWorkspaceId,
        kbCount: localKbs.length,
        source: 'localdb',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.catch('HomePage', 'loadKBList', err)
      logAction('HomePage:加载知识库列表异常', 'HomePage', { error: msg })
      setMessage(msg || '加载知识库列表失败')
      setMessageError(true)
    } finally {
      setLoading(false)
    }
  }, [currentWorkspaceId, resolveKnowledgeBaseCoverUrl, setMessage, setMessageError])

  useEffect(() => {
    loadKBList()
  }, [loadKBList])

  useEffect(() => {
    function onBootstrapApplied(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (!detail?.workspaceId || detail.workspaceId !== currentWorkspaceId) {
        return
      }
      void loadKBList()
    }

    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, onBootstrapApplied)
    return () => {
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, onBootstrapApplied)
    }
  }, [currentWorkspaceId, loadKBList])

  const openKB = useCallback(async (kb: KBItem) => {
    const opened = tabStore.getState().openKnowledgeBase(kb)
    if (!opened) return
    logAction('打开知识库成功', 'HomePage', { kbInfo: kb })
  }, [])

  const refreshKBList = useCallback(async () => {
    await loadKBList()
  }, [loadKBList])

  const reorderKBs = useCallback(async (newOrder: string[]) => {
    setKbs((prev) => {
      const next = [...prev]
      next.sort((a, b) => {
        const orderA = newOrder.indexOf(a.name)
        const orderB = newOrder.indexOf(b.name)
        return (orderA !== -1 ? orderA : Infinity) - (orderB !== -1 ? orderB : Infinity)
      })
      return next
    })
  }, [])

  return {
    loading,
    kbs,
    openKB,
    refreshKBList,
    reorderKBs,
  }
}

