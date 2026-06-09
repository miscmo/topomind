import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { syncWorkspacePullIntoLocalMirror } from '../../../../application/cloud/localdb-sync'
import { cloudApi } from '../../../../core/cloud-api'
import { LocalDB } from '../../../../core/localdb-backend'
import { logger } from '../../../../core/logger'
import { logAction } from '../../../../core/log-backend'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../../../../shared/ui/modal'

interface CardTrashDialogProps {
  visible: boolean
  workspaceId: string | null
  kbId: string | null
  onClose: () => void
  refreshGraph: () => Promise<void>
}

interface CardTrashItem {
  cardId: string
  originalName: string
  parentId: string | null
  deletedAt: number
}

function formatDeletedAt(value: number) {
  if (!Number.isFinite(value)) return '未知时间'
  return new Date(value).toLocaleString('zh-CN')
}

export function CardTrashDialog({
  visible,
  workspaceId,
  kbId,
  onClose,
  refreshGraph,
}: CardTrashDialogProps) {
  const [items, setItems] = useState<CardTrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    if (!visible || !workspaceId || !kbId) return
    setLoading(true)
    setError('')
    try {
      const snapshot = await LocalDB.getWorkspaceSnapshot(workspaceId)
      const deletedCards = snapshot.cards
        .filter((card) => card.kbId === kbId && card.deletedAt)
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .map((card) => ({
          cardId: card.id,
          originalName: card.name,
          parentId: card.parentId ?? null,
          deletedAt: new Date(card.deletedAt as string).getTime(),
        }))
      setItems(deletedCards)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('CardTrashDialog', 'loadItems', e)
    } finally {
      setLoading(false)
    }
  }, [kbId, visible, workspaceId])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleRestore = useCallback(async (item: CardTrashItem) => {
    setLoading(true)
    setError('')
    try {
      if (!workspaceId) {
        throw new Error('当前工作区未就绪，暂时无法恢复节点')
      }
      const restored = await cloudApi.restoreWorkspaceCard(workspaceId, item.cardId)
      await syncWorkspacePullIntoLocalMirror(workspaceId)
      await refreshGraph()
      await loadItems()
      logAction('回收站:恢复节点', 'CardTrashDialog', {
        cardId: item.cardId,
        restoredName: restored.name,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('CardTrashDialog', 'handleRestore', e)
    } finally {
      setLoading(false)
    }
  }, [loadItems, refreshGraph, workspaceId])

  const handleClear = useCallback(async () => {
    if (items.length === 0) return
    const confirmed = window.confirm('确定要永久清空当前知识库回收站中的节点及其子树吗？该操作不可恢复。')
    if (!confirmed) return

    setLoading(true)
    setError('')
    try {
      if (!workspaceId) {
        throw new Error('当前工作区未就绪，暂时无法清空节点回收站')
      }
      let purgedCount = 0
      for (const item of items) {
        try {
          await cloudApi.purgeWorkspaceCard(workspaceId, item.cardId)
          purgedCount += 1
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (message.includes('Card not found')) {
            continue
          }
          throw e
        }
      }
      await syncWorkspacePullIntoLocalMirror(workspaceId)
      await refreshGraph()
      await loadItems()
      logAction('回收站:清空节点', 'CardTrashDialog', {
        count: purgedCount,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.catch('CardTrashDialog', 'handleClear', e)
    } finally {
      setLoading(false)
    }
  }, [items, loadItems, refreshGraph, workspaceId])

  if (!visible) return null

  return (
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`w-[560px] max-w-[92%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`}>
        <div className="flex items-center justify-between border-b border-[var(--color-border-light)] bg-[var(--color-bg)] p-[18px_24px] [&>h3]:m-0 [&>h3]:text-[16px] [&>h3]:font-bold [&>h3]:text-[var(--color-primary)]">
          <h3>节点回收站</h3>
          <button className="h-7 w-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[14px] text-[var(--color-text-muted)] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div className="mb-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] text-[var(--color-danger)]">{error}</div>}
          <div className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
            这里显示当前知识库中已删除的节点。当前云端本地镜像已支持从回收站恢复节点，并按整棵子树语义永久清空已删除节点。
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[var(--color-border-light)]">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">加载中...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">回收站为空</div>
            ) : (
              items.map((item) => (
                <div key={item.cardId} className="flex items-center justify-between gap-4 border-b border-[var(--color-border-light)] p-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[var(--color-text-primary)]" title={item.originalName}>{item.originalName}</div>
                    <div className="mt-1 truncate text-[12px] text-[var(--color-text-muted)]">删除时间：{formatDeletedAt(item.deletedAt)}</div>
                  </div>
                  <button
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleRestore(item)}
                    disabled={loading}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    恢复
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-[var(--color-border-light)] bg-[var(--color-bg)] p-[14px_24px]">
          <button
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleClear()}
            disabled={loading || items.length === 0}
          >
            清空回收站
          </button>
          <button className="rounded-lg border-none bg-[var(--color-hover-bg)] px-5 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose} disabled={loading}>关闭</button>
        </div>
      </div>
    </div>
  )
}
