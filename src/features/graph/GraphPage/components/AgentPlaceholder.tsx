/**
 * AI Agent 入口占位页（Left Dock 的第二个页面）。
 *
 * 目前只预留入口：对话能力、Provider 选型、会话存储都尚未确定，
 * 这里不引入任何 AI SDK、网络调用或持久化状态，也不放一个点了没反应的假输入框。
 * 等能力定下来后，直接把这个组件换成真正的会话面板即可，Dock 外壳零改动。
 */
import { Sparkles } from 'lucide-react'
import { EmptyState } from '@/shared/ui/EmptyState'
import { TM_UI } from '@/shared/ui/controlStyles'

export default function AgentPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-8">
      <EmptyState
        size="md"
        icon={<Sparkles className="h-6 w-6" strokeWidth={1.8} />}
        title="AI Agent"
        description="对话助手入口已预留，能力与交互方式正在设计中。"
      />
      <span className={TM_UI.badgeAccent}>即将上线</span>
    </div>
  )
}
