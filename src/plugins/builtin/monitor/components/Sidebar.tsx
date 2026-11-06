
import { ScrollText, Activity, Settings } from 'lucide-react'
import { useMonitorStore } from '@/plugins/public/monitorStore'
import { useMonitorHost } from '../hostContext'
import { LEVEL_COLORS } from '../constants'

export function Sidebar() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const setActiveTab = useMonitorStore((s) => s.setActiveTab)
  const stats = useMonitorStore((s) => s.stats)
  const pluginDiagnostics = useMonitorStore((s) => s.pluginDiagnostics)
  const { log } = useMonitorHost()

  const pluginFailedCount = pluginDiagnostics.filter((item) => item.state === 'failed').length

  const handleTabClick = (tab: 'log' | 'performance' | 'plugins') => {
    log.info('monitor tab changed', { tab, previousTab: activeTab })
    setActiveTab(tab)
  }

  return (
    <aside className="w-[220px] min-w-[220px] bg-[var(--titlebar-bg)] border-r border-[var(--color-border-subtle)] flex flex-col text-[var(--color-text-secondary)]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 text-[14px] font-semibold text-[var(--color-text-primary)] border-b border-[var(--color-border-subtle)] tracking-[0.3px]">
        <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] shrink-0" aria-hidden="true" />
        <span>TopoMind</span>
      </div>
      <nav className="flex flex-col py-2 gap-0.5">
        <button
          className={`flex items-center gap-2 py-2 px-4 bg-transparent border-none text-[var(--color-text-secondary)] text-[13px] cursor-pointer text-left transition-all duration-75 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] ${activeTab === 'log' ? '!bg-[var(--color-selected-bg)] !text-[var(--color-accent)] font-semibold' : ''}`}
          onClick={() => handleTabClick('log')}
        >
          <ScrollText className="h-4 w-4 shrink-0" />
          <span>日志监控</span>
          {stats.error > 0 && (
            <span className="ml-auto bg-[var(--color-danger)] text-[var(--color-text-inverse)] text-[10px] font-semibold py-[1px] px-[5px] rounded-lg min-w-[18px] text-center">
              {stats.error}
            </span>
          )}
        </button>
        <button
          className={`flex items-center gap-2 py-2 px-4 bg-transparent border-none text-[var(--color-text-secondary)] text-[13px] cursor-pointer text-left transition-all duration-75 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] ${activeTab === 'performance' ? '!bg-[var(--color-selected-bg)] !text-[var(--color-accent)] font-semibold' : ''}`}
          onClick={() => handleTabClick('performance')}
        >
          <Activity className="h-4 w-4 shrink-0" />
          <span>性能监控</span>
          <span className="ml-auto w-[18px]" />
        </button>
        <button
          className={`flex items-center gap-2 py-2 px-4 bg-transparent border-none text-[var(--color-text-secondary)] text-[13px] cursor-pointer text-left transition-all duration-75 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] ${activeTab === 'plugins' ? '!bg-[var(--color-selected-bg)] !text-[var(--color-accent)] font-semibold' : ''}`}
          onClick={() => handleTabClick('plugins')}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>插件诊断</span>
          {pluginFailedCount > 0 ? (
            <span className="ml-auto bg-[var(--color-danger)] text-[var(--color-text-inverse)] text-[10px] font-semibold py-[1px] px-[5px] rounded-lg min-w-[18px] text-center">
              {pluginFailedCount}
            </span>
          ) : (
            <span className="ml-auto w-[18px]" />
          )}
        </button>
      </nav>
      <div className="mt-auto py-3 px-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)]">
        <div className="text-[10px] uppercase tracking-[0.8px] text-[var(--color-text-muted)] mb-2 font-medium">统计</div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS.DEBUG }} />
          <span className="text-[var(--color-text-secondary)] flex-1">DEBUG</span>
          <span className="text-[var(--color-text-primary)] font-mono text-[11px]">{stats.debug}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS.INFO }} />
          <span className="text-[var(--color-text-secondary)] flex-1">INFO</span>
          <span className="text-[var(--color-text-primary)] font-mono text-[11px]">{stats.info}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS.WARN }} />
          <span className="text-[var(--color-text-secondary)] flex-1">WARN</span>
          <span className="text-[var(--color-text-primary)] font-mono text-[11px]">{stats.warn}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS.ERROR }} />
          <span className="text-[var(--color-text-secondary)] flex-1">ERROR</span>
          <span className="text-[var(--color-text-primary)] font-mono text-[11px]">{stats.error}</span>
        </div>
        <div className="mt-2 pt-1.5 border-t border-[var(--color-border-subtle)] text-[11px] text-[var(--color-text-muted)] text-center">共 {stats.total} 条</div>
      </div>
    </aside>
  )
}
