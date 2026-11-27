/**
 * AI 会话 tab 栏（P4-T）。
 *
 * 只负责「已打开会话」的横向条：中段 flex-1 + min-w-0，超出宽度由
 * .tm-ai-tabs 自己的细横向滚动条接管，右侧操作按钮组是 shrink-0 兄弟，
 * 永远固定不被挤走。切换 / 关闭的真实编排由 AgentPanel 交给 listStore，
 * 本组件不直接改任何会话状态。
 *
 * 激活 tab 自动滚入可视区时只改 strip.scrollLeft，不调用 scrollIntoView，
 * 避免连带滚动整个左栏或窗口。
 */
import { useEffect, useRef } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import type { AiSessionSummary } from '@/core/ai-types'

interface AgentSessionTabsProps {
  tabIds: string[]
  activeId: string | null
  summaries: AiSessionSummary[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export default function AgentSessionTabs({
  tabIds, activeId, summaries, onSelect, onClose,
}: AgentSessionTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const strip = stripRef.current
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!strip || !active) return
    const box = active.getBoundingClientRect()
    const view = strip.getBoundingClientRect()
    if (box.left < view.left) strip.scrollLeft -= view.left - box.left + 4
    else if (box.right > view.right) strip.scrollLeft += box.right - view.right + 4
  }, [activeId, tabIds])

  const titleOf = (id: string) => summaries.find((item) => item.id === id)?.title ?? '新会话'
  const canClose = tabIds.length > 1

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="打开的会话"
      className={tmUI(TM_UI.aiTabs, 'min-w-0 flex-1')}
      data-tm-ai-session-tabs=""
    >
      {tabIds.map((id) => {
        const selected = id === activeId
        return (
          <div
            key={id}
            role="tab"
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-label={titleOf(id)}
            title={titleOf(id)}
            data-tm-ai-session-tab={id}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(id)
              }
            }}
            className={selected ? TM_UI.aiTabActive : TM_UI.aiTab}
          >
            <MessageSquare className={TM_UI.aiTabIcon} aria-hidden="true" />
            <span
              className={TM_UI.aiTabLabel}
              data-tm-ai-session-current={selected ? '' : undefined}
            >
              {titleOf(id)}
            </span>
            {canClose && (
              <button
                type="button"
                title={`关闭会话：${titleOf(id)}`}
                aria-label={`关闭会话：${titleOf(id)}`}
                data-tm-ai-session-tab-close={id}
                className={TM_UI.aiTabClose}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(id)
                }}
              >
                <X className={TM_UI.iconSm} aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
