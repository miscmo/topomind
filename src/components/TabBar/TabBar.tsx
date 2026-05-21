// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { logAction } from '../../core/log-backend'

const TabItem = memo(function TabItem({ tab, isActive, onClick, onClose }: {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <div
      className={`group flex items-center gap-1.5 h-7 px-3 rounded-lg cursor-default text-[13px] font-medium bg-transparent border border-transparent transition-all relative select-none max-w-[180px] shrink-0 mt-auto mb-[5px] ${
        isActive 
          ? 'bg-[var(--color-surface)] text-[var(--color-primary)] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.04)] border-[var(--color-border-subtle)]' 
          : 'text-[var(--titlebar-muted)] hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]'
      }`}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ WebkitAppRegion: 'no-drag' } as any}
      role="tab"
      aria-selected={isActive}
      title={tab.label}
    >
      <span className="truncate">
        {tab.label}
      </span>
      {tab.id !== 'home' && (
        <button
          className={`w-4 h-4 rounded-[3px] border-none bg-transparent cursor-pointer flex items-center justify-center text-[11px] text-[var(--color-text-muted)] p-0 leading-none shrink-0 transition-all hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger-hover)] ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label={`关闭 ${tab.label}`}
        >
          ×
        </button>
      )}
    </div>
  )
})

export default memo(function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)

  const handleCloseTab = (tabId: string) => {
    const tab = useTabStore.getState().closeTab(tabId)
    if (!tab) return
    logAction('Tab:关闭', 'TabBar', { tab })
  }

  // 处理 Tab 切换：纯恢复已保存状态，不重放 enterRoom 导航动作
  const handleTabClick = async (tab: Tab) => {
    if (tab.id === activeTabId) return
    activateTab(tab.id)
    logAction('切换Tab', 'TabBar', { tabId: tab.id, tabLabel: tab.label })
  }

  // 无论有多少个 Tab，都渲染 TabBar 占位，保持顶部视觉平衡
  // if (tabs.length <= 1) return null

  return (
    <div 
      className="flex items-end h-full px-1 gap-[2px] shrink-0 w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" 
      role="tablist"
      style={{ WebkitAppRegion: 'drag' } as any}
      onWheel={(e) => {
        // Convert vertical scroll to horizontal scroll
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => handleTabClick(tab)}
          onClose={() => handleCloseTab(tab.id)}
        />
      ))}
    </div>
  )
})