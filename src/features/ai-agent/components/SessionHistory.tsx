/**
 * 历史会话列表（P4-S）。
 *
 * 只消费 agentSessionListStore 的摘要，正文由主进程 sessions.json 提供；
 * 列表项「打开」会先 flush 当前会话再换入历史正文，避免切换丢 last token。
 * 删除用内联二次确认而不是 window.confirm：Electron 里原生弹窗会打断
 * 左栏操作，也和既有 tm-* 控件体系不一致。窄栏 240 下所有行都 min-w-0。
 */
import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { useAgentSessionListStore } from '../model/agentSessionListStore'

function formatTime(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

export default function SessionHistory() {
  const summaries = useAgentSessionListStore((state) => state.summaries)
  const activeId = useAgentSessionListStore((state) => state.activeSessionId)
  const loading = useAgentSessionListStore((state) => state.loading)
  const error = useAgentSessionListStore((state) => state.error)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const createNew = () => {
    void useAgentSessionListStore.getState().newSession()
    setConfirmId(null)
  }

  const open = (id: string) => {
    if (busyId || id === activeId) return
    setConfirmId(null)
    setBusyId(id)
    void useAgentSessionListStore.getState().switchSession(id).finally(() => setBusyId(null))
  }

  const remove = (id: string) => {
    if (busyId) return
    setBusyId(id)
    void useAgentSessionListStore.getState().deleteSession(id).finally(() => {
      setBusyId(null)
      setConfirmId(null)
    })
  }

  return (
    <div
      className="shrink-0 border-b border-[var(--color-border-light)] px-2 py-2"
      data-tm-ai-session-history=""
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <span className="tm-label">历史会话 · {summaries.length}</span>
        <button type="button" onClick={createNew} className={TM_UI.button} data-tm-ai-session-new="">
          <Plus className="mr-1 inline h-3 w-3" />新建会话
        </button>
      </div>

      {error && (
        <div className="mb-2 break-words text-xs text-[var(--color-danger)]" data-tm-ai-session-error="">
          {error}
        </div>
      )}
      {loading && summaries.length === 0 && <div className="tm-hint mb-2">正在载入历史会话…</div>}
      {!loading && summaries.length === 0 && !error && (
        <div className="tm-hint mb-2">暂无历史会话</div>
      )}

      <div className={tmUI(TM_UI.scroll, 'max-h-60 overflow-y-auto')} data-tm-ai-session-list="">
        {summaries.map((item) => {
          const isActive = item.id === activeId
          if (confirmId === item.id) {
            return (
              <div
                key={item.id}
                className="mb-1 flex min-w-0 items-center gap-1 rounded-lg border border-[var(--color-danger)] px-2 py-1"
                data-tm-ai-session-confirm={item.id}
              >
                <span className="tm-hint min-w-0 flex-1 truncate">删除「{item.title}」？</span>
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => remove(item.id)}
                  className={TM_UI.button}
                  data-tm-ai-session-confirm-delete=""
                >
                  删除
                </button>
                <button
                  type="button"
                  aria-label="取消删除"
                  title="取消删除"
                  onClick={() => setConfirmId(null)}
                  className={TM_UI.iconButton}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          }
          return (
            <div key={item.id} className="mb-1 flex min-w-0 items-center gap-1">
              <button
                type="button"
                disabled={Boolean(busyId)}
                aria-current={isActive ? 'true' : undefined}
                title={`打开会话：${item.title}`}
                onClick={() => open(item.id)}
                data-tm-ai-session-item={item.id}
                className={tmUI(
                  'min-w-0 flex-1 rounded-lg border px-2 py-1 text-left',
                  isActive
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border-light)] bg-[var(--color-surface)]',
                )}
              >
                <span className="block truncate text-xs">{item.title}</span>
                <span className="tm-hint block truncate">
                  {formatTime(item.updatedAt)} · {item.messageCount} 条消息
                </span>
              </button>
              <button
                type="button"
                disabled={Boolean(busyId)}
                title="删除会话"
                aria-label={`删除会话：${item.title}`}
                onClick={() => setConfirmId(item.id)}
                className={TM_UI.iconButton}
                data-tm-ai-session-delete={item.id}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="tm-hint mt-2">历史会话保存在当前工作目录，重开软件后可继续打开</div>
    </div>
  )
}
