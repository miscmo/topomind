import {
  Activity,
  ListTree,
  Network,
  ScrollText,
  Settings,
  ShieldAlert,
} from 'lucide-react'
import { useMonitorStore, type MonitorTab } from '@/plugins/public/monitorStore'
import { useMonitorHost } from '../hostContext'
import { LEVEL_COLORS } from '../constants'

/**
 * v3 P4：方案 §6 五视图 + 保留「原始日志」排障底栏。
 * 全部字号走设计系统 CSS 变量，不新增 text-[Npx] 字面值（按次冻结基线）。
 */
const TABS: Array<{ id: MonitorTab; label: string; icon: typeof Activity; hint: string }> = [
  { id: 'timeline', label: '事件流', icon: ListTree, hint: '按 session 分组、按 trace 折叠，可回放' },
  { id: 'spans', label: '内部链路', icon: Network, hint: 'span 瀑布与父子调用' },
  { id: 'errors', label: '异常与崩溃', icon: ShieldAlert, hint: '指纹聚合、恢复报告、诊断包' },
  { id: 'performance', label: '性能监控', icon: Activity, hint: '慢样本反查用户事件' },
  { id: 'plugins', label: '插件诊断', icon: Settings, hint: '插件状态机与激活原因' },
  { id: 'log', label: '原始日志', icon: ScrollText, hint: '平铺列表与完整详情' },
]

const TM_UI = {
  tab: 'flex items-center gap-2 py-2 px-4 bg-transparent border-none cursor-pointer text-left transition-all duration-75 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] tm-tab',
  badge: 'ml-auto py-[1px] px-[5px] rounded-lg min-w-[18px] text-center font-semibold tm-badge',
}

export function Sidebar() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const setActiveTab = useMonitorStore((s) => s.setActiveTab)
  const stats = useMonitorStore((s) => s.stats)
  const pluginDiagnostics = useMonitorStore((s) => s.pluginDiagnostics)
  const { log } = useMonitorHost()

  const pluginFailedCount = pluginDiagnostics.filter((item) => item.state === 'failed').length

  const handleTabClick = (tab: MonitorTab) => {
    log.info('monitor view changed', { view: tab, previousView: activeTab })
    setActiveTab(tab)
  }

  const badgeFor = (tab: MonitorTab): number | null => {
    if (tab === 'errors') return stats.error
    if (tab === 'plugins') return pluginFailedCount
    return null
  }

  return (
    <aside className="w-[220px] min-w-[220px] bg-[var(--titlebar-bg)] border-r border-[var(--color-border-subtle)] flex flex-col text-[var(--color-text-secondary)]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 font-semibold text-[var(--color-text-primary)] border-b border-[var(--color-border-subtle)] tracking-[0.3px]" style={{ fontSize: 'var(--font-size-lg)' }}>
        <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] shrink-0" aria-hidden="true" />
        <span>TopoMind</span>
      </div>
      <nav className="flex flex-col py-2 gap-0.5">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          const badge = badgeFor(tab.id)
          return (
            <button
              key={tab.id}
              className={`${TM_UI.tab} ${active
                ? '!bg-[var(--color-selected-bg)] !text-[var(--color-accent)] font-semibold'
                : 'text-[var(--color-text-secondary)]'}`}
              style={{ fontSize: 'var(--font-size-md)' }}
              title={tab.hint}
              onClick={() => handleTabClick(tab.id)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
              {badge && badge > 0 ? (
                <span
                  className={`${TM_UI.badge} bg-[var(--color-danger)] text-[var(--color-text-inverse)]`}
                  style={{ fontSize: 'var(--font-size-xs)' }}
                >
                  {badge}
                </span>
              ) : (
                <span className="ml-auto w-[18px]" />
              )}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto py-3 px-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)]">
        <div className="uppercase tracking-[0.8px] text-[var(--color-text-muted)] mb-2 font-medium" style={{ fontSize: 'var(--font-size-xs)' }}>统计</div>
        {(['DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map((level) => (
          <div key={level} className="flex items-center gap-1.5 mb-1" style={{ fontSize: 'var(--font-size-sm)' }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LEVEL_COLORS[level] }} />
            <span className="text-[var(--color-text-secondary)] flex-1">{level}</span>
            <span className="text-[var(--color-text-primary)] font-mono">{stats[level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error']}</span>
          </div>
        ))}
        <div className="mt-2 pt-1.5 border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)] text-center" style={{ fontSize: 'var(--font-size-sm)' }}>
          共 {stats.total} 条
        </div>
      </div>
    </aside>
  )
}
