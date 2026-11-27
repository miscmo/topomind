/**
 * 历史会话浮窗（P4-S → P4-T）。
 *
 * 从「顶部下面再占一条窄栏的内联列表」改为挂在标题栏下方的浮层：
 *  - 只消费 agentSessionListStore 的摘要，正文由主进程 sessions.json 提供；
 *  - 点击条目统一走 switchSession（flush 当前会话 → 换入历史正文），
 *    tab 栏由 agentSessionTabsStore 订阅 activeSessionId 自动补位：
 *    未打开过的会话会新增 tab，已打开过的只切激活态、不重复插入；
 *  - 「已在会话栏」用小圆点标记，浮窗不随点击自动关闭，方便连开多个会话；
 *    关闭入口：右上角 X / 再次点历史按钮 / 点击浮窗外 / Escape。
 *  - 删除用内联二次确认而不是 window.confirm；240px 窄栏下所有行 min-w-0。
 *
 * 稳定性契约：data-tm-ai-session-* 全套选择器保留，历史 GUI 冒烟无需改写。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Clock3, Plus, Trash2, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { useAgentSessionListStore } from '../model/agentSessionListStore'
import { useAgentSessionTabsStore } from '../model/agentSessionTabsStore'

interface SessionHistoryProps {
  /** 历史按钮：定位锚点 + 「点击外部关闭」白名单。 */
  triggerRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

export default function SessionHistory({ triggerRef, onClose }: SessionHistoryProps) {
  const summaries = useAgentSessionListStore((state) => state.summaries)
  const activeId = useAgentSessionListStore((state) => state.activeSessionId)
  const loading = useAgentSessionListStore((state) => state.loading)
  const error = useAgentSessionListStore((state) => state.error)
  const openSessionIds = useAgentSessionTabsStore((state) => state.openSessionIds)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // 捕获阶段监听：左栏不是标题栏拖拽区，不需要 no-drag 透明遮罩。
  // trigger 与浮窗内部都算「内部点击」，避免点历史按钮时先关再开。
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node
        && (popoverRef.current?.contains(target) || triggerRef.current?.contains(target))) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, triggerRef])

  const createNew = () => {
    void useAgentSessionListStore.getState().newSession()
    setConfirmId(null)
  }

  const open = (id: string) => {
    if (busyId === id || id === activeId) return
    setConfirmId(null)
    setBusyId(id)
    void useAgentSessionListStore.getState().switchSession(id).finally(() => setBusyId(null))
  }

  const remove = (id: string) => {
    if (busyId === id) return
    setBusyId(id)
    void useAgentSessionListStore.getState().deleteSession(id).finally(() => {
      setBusyId(null)
      setConfirmId(null)
    })
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="历史会话"
      className={tmUI(
        TM_UI.aiSessionPopover,
        'tm-fade-enter absolute left-1 right-1 top-full mt-1.5 flex max-h-[60vh] min-w-0 flex-col',
      )}
      data-tm-ai-session-history=""
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-light)] px-2.5 py-2">
        <Clock3 className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" strokeWidth={1.8} />
        <span className="tm-label min-w-0 flex-1 truncate">历史会话 · {summaries.length}</span>
        <button type="button" onClick={createNew} className={TM_UI.button} data-tm-ai-session-new="">
          <Plus className="mr-1 inline h-3 w-3" />新建会话
        </button>
        <button
          type="button"
          title="关闭历史会话"
          aria-label="关闭历史会话"
          onClick={onClose}
          className={TM_UI.iconButton}
          data-tm-ai-session-close=""
        >
          <X className={TM_UI.iconSm} />
        </button>
      </div>

      {error && (
        <div className="shrink-0 break-words px-2.5 py-1.5 text-xs text-[var(--color-danger)]" data-tm-ai-session-error="">
          {error}
        </div>
      )}
      {loading && summaries.length === 0 && <div className="tm-hint shrink-0 px-2.5 py-2">正在载入历史会话…</div>}
      {!loading && summaries.length === 0 && !error && (
        <div className="tm-hint shrink-0 px-2.5 py-3">暂无历史会话</div>
      )}

      <div
        className={tmUI(TM_UI.scroll, 'min-h-0 flex-1 overflow-y-auto p-2')}
        data-tm-ai-session-list=""
      >
        {summaries.map((item) => {
          const isActive = item.id === activeId
          const isOpened = openSessionIds.includes(item.id)
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
                  disabled={busyId === item.id}
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
                  <X className={TM_UI.iconSm} />
                </button>
              </div>
            )
          }
          return (
            <div key={item.id} className="mb-1 flex min-w-0 items-center gap-1">
              <button
                type="button"
                disabled={busyId === item.id}
                aria-current={isActive ? 'true' : undefined}
                title={isOpened ? `已在会话栏打开：${item.title}` : `打开会话：${item.title}`}
                onClick={() => open(item.id)}
                data-tm-ai-session-item={item.id}
                className={tmUI(
                  TM_UI.aiSessionItem,
                  isActive && TM_UI.aiSessionItemActive,
                  'min-w-0 flex-1',
                )}
              >
                {isOpened && <span className={TM_UI.aiSessionOpenDot} aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className={TM_UI.aiSessionItemTitle}>{item.title}</span>
                  <span className={TM_UI.aiSessionItemMeta}>
                    {formatTime(item.updatedAt)} · {item.messageCount} 条消息
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={busyId === item.id}
                title="删除会话"
                aria-label={`删除会话：${item.title}`}
                onClick={() => setConfirmId(item.id)}
                className={TM_UI.iconButton}
                data-tm-ai-session-delete={item.id}
              >
                <Trash2 className={TM_UI.iconSm} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="tm-hint flex shrink-0 items-center gap-1 border-t border-[var(--color-border-light)] px-2.5 py-1.5">
        <span className={TM_UI.aiSessionOpenDot} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">已在会话栏打开 · 会话随工作目录保存，重开可继续</span>
      </div>
    </div>
  )
}
