/**
 * 左栏「知识库列表」页面：列出当前工作区的知识库，点一下切到 / 打开对应 tab。
 *
 * 刻意不复用首页的重型网格（封面 base64、节点计数、拖动排序、创建导入）：
 * 左栏只有 280px，这里要的是「在画布里快速换库」，管理和封面仍归首页。
 * 也不重复首页的 kb.list_load 埋点：只发一次 listKBs，打开动作记 kb.open。
 */
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { TM_UI } from '@/shared/ui/controlStyles'
import { logAction } from '../../../../core/log-backend'
import { useStorage } from '../../../../core/storage'
import { tabStore, useGraphSession } from '../../../../stores/tabs/tabStore'
import type { KBListItem } from '../../../../types'

interface KnowledgeBaseListPanelProps {
  tabId: string
}

export default function KnowledgeBaseListPanel({ tabId }: KnowledgeBaseListPanelProps) {
  const storage = useStorage()
  const session = useGraphSession(tabId)
  const activeKbPath = session?.kbPath ?? ''
  const [kbs, setKbs] = useState<KBListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  // 刷新时的 loading 在点击回调里置位，不在 effect 里同步 setState（避免级联渲染）。
  useEffect(() => {
    let cancelled = false
    void storage.listKBs()
      .then((list) => {
        if (cancelled) return
        setKbs(list ?? [])
        setError('')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [storage, reloadToken])

  const openKB = useCallback((name: string) => {
    const opened = tabStore.getState().openKnowledgeBase({ name })
    if (!opened) return
    logAction('kb.open', 'kb', { kbName: name, source: 'left-dock' })
  }, [])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }, [])

  return (
    <div data-tm-kb-list-panel="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-3">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <span className="min-w-0 flex-1 text-xs text-[var(--color-text-muted)]">点击切换到对应知识库</span>
        <button
          type="button"
          data-tm-kb-list-refresh=""
          title="刷新知识库列表"
          aria-label="刷新知识库列表"
          onClick={reload}
          className={TM_UI.iconButton}
        >
          <RefreshCw className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && <div className="px-3 py-4 text-xs text-[var(--color-text-muted)]">正在加载知识库…</div>}
        {!loading && error && <div className="px-3 py-4 text-xs text-[var(--color-danger)]">{error}</div>}
        {!loading && !error && kbs.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--color-text-muted)]">当前工作区还没有知识库</div>
        )}
        {kbs.map((kb) => (
          <button
            key={kb.name}
            type="button"
            data-tm-kb-list-item={kb.name}
            data-tm-kb-list-active={activeKbPath === kb.name ? 'true' : 'false'}
            title={`打开知识库 ${kb.name}`}
            onClick={() => openKB(kb.name)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs hover:bg-[var(--color-hover-bg)]"
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{kb.name}</span>
            {activeKbPath === kb.name && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
            )}
          </button>
        ))}
      </div>

      <div className="flex h-7 shrink-0 items-center border-t border-[var(--color-border-light)] px-3 text-xs text-[var(--color-text-muted)]">
        共 {kbs.length} 个知识库 · 新建与导入在首页
      </div>
    </div>
  )
}
